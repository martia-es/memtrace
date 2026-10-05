import { lookup as dnsLookup, type LookupOptions } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import type { HealthProber } from "@/application/ports/health-prober";
import { isBlockedAddress, isProbeableUrl, type ProbeResult } from "@/domain/assistant-registry";

export interface HttpHealthProberOptions {
  timeoutMs?: number;
  /** Permite redes privadas y loopback (desarrollo). Link-local y metadata de la nube nunca se permiten. */
  allowPrivateNetworks?: boolean;
}

/**
 * Sondeo de /health con protección SSRF (ADR-053). La comprobación de la dirección se hace en la propia conexión
 * (opción `lookup` del socket), no antes: así un DNS que cambie de respuesta entre comprobar y conectar (rebinding) no la
 * esquiva. No sigue redirecciones (un 3xx cuenta como fallo) y descarta el cuerpo: solo importa el código y la latencia.
 */
export class HttpHealthProber implements HealthProber {
  private readonly timeoutMs: number;
  private readonly allowPrivateNetworks: boolean;

  constructor(options: HttpHealthProberOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.allowPrivateNetworks = options.allowPrivateNetworks ?? false;
  }

  probe(url: string): Promise<ProbeResult> {
    if (!isProbeableUrl(url)) return Promise.resolve({ httpStatus: null, latencyMs: null, error: "URL is not a plain http(s) URL" });
    return new Promise((resolve) => {
      const started = performance.now();
      let settled = false;
      const finish = (result: ProbeResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const fail = (message: string) => finish({ httpStatus: null, latencyMs: null, error: message });

      const target = new URL(url);
      // Node no llama a `lookup` cuando el host ya es una IP: sin esta comprobación, `http://169.254.169.254/` la esquivaría
      const literal = target.hostname.replace(/^\[|\]$/g, "");
      if (isIP(literal) !== 0 && isBlockedAddress(literal, { allowPrivateNetworks: this.allowPrivateNetworks })) return fail(blocked(literal).message);
      const transport = target.protocol === "https:" ? https : http;
      const request = transport.request(
        target,
        {
          method: "GET",
          timeout: this.timeoutMs,
          headers: { "User-Agent": "memtrace-health-probe/1", Accept: "*/*" },
          lookup: guardedLookup(this.allowPrivateNetworks),
        },
        (response) => {
          const latencyMs = Math.round(performance.now() - started);
          response.resume();
          finish({ httpStatus: response.statusCode ?? null, latencyMs, error: null });
        },
      );
      request.on("timeout", () => {
        fail(`No response in ${this.timeoutMs} ms`);
        request.destroy();
      });
      request.on("error", (error: NodeJS.ErrnoException) => fail(error.code === "ECONNREFUSED" ? "Connection refused" : error.message));
      request.end();
    });
  }
}

/**
 * `lookup` del socket que rechaza direcciones no permitidas (SSRF). Lo comparten el sondeo de /health y el proxy de chat.
 * Node pide `all: true` desde v20 (autoSelectFamily): se devuelve el formato que pida, validando cada dirección.
 */
export function guardedLookup(allowPrivateNetworks: boolean): LookupFunction {
  const lookup = (hostname: string, options: LookupOptions, callback: (...args: unknown[]) => void) => {
    const check = (address: string) => isBlockedAddress(address, { allowPrivateNetworks });
    if (isIP(hostname) !== 0) {
      if (check(hostname)) return callback(blocked(hostname));
      return options.all ? callback(null, [{ address: hostname, family: isIP(hostname) }]) : callback(null, hostname, isIP(hostname));
    }
    dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error);
      const list = addresses as unknown as Array<{ address: string; family: number }>;
      const bad = list.find((a) => check(a.address));
      if (bad) return callback(blocked(bad.address));
      return options.all ? callback(null, list) : callback(null, list[0]!.address, list[0]!.family);
    });
  };
  return lookup as LookupFunction;
}

/** ¿El host de la URL es una IP literal no permitida? Node no llama a `lookup` con IPs, así que se comprueba aparte. */
export function isBlockedLiteralHost(url: URL, allowPrivateNetworks: boolean): string | null {
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  return isIP(literal) !== 0 && isBlockedAddress(literal, { allowPrivateNetworks }) ? literal : null;
}

function blocked(address: string): NodeJS.ErrnoException {
  const error = new Error(`Address ${address} is not allowed`) as NodeJS.ErrnoException;
  error.code = "EBLOCKED";
  return error;
}
