import http from "node:http";
import https from "node:https";
import type { ChatCallResult, ChatClient } from "@/application/ports/chat-client";
import { isProbeableUrl } from "@/domain/assistant-registry";
import { guardedLookup, isBlockedLiteralHost } from "./http-health-prober";

export interface HttpChatClientOptions {
  /** Un agente puede tardar (modelo + tools): bastante más que un /health. */
  timeoutMs?: number;
  maxResponseBytes?: number;
  allowPrivateNetworks?: boolean;
}

/**
 * POST JSON al chat de un asistente (ADR-055). Misma protección SSRF que el sondeo: la dirección se valida en la propia
 * conexión (rebinding), no sigue redirecciones y limita el tamaño de la respuesta. No envía credenciales ni cookies del usuario.
 */
export class HttpChatClient implements ChatClient {
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly allowPrivateNetworks: boolean;

  constructor(options: HttpChatClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.maxResponseBytes = options.maxResponseBytes ?? 1_000_000;
    this.allowPrivateNetworks = options.allowPrivateNetworks ?? false;
  }

  send(url: string, body: Record<string, string>): Promise<ChatCallResult> {
    const failure = (error: string): ChatCallResult => ({ httpStatus: null, body: null, latencyMs: null, error });
    if (!isProbeableUrl(url)) return Promise.resolve(failure("URL is not a plain http(s) URL"));
    const target = new URL(url);
    const blockedHost = isBlockedLiteralHost(target, this.allowPrivateNetworks);
    if (blockedHost) return Promise.resolve(failure(`Address ${blockedHost} is not allowed`));

    const payload = JSON.stringify(body);
    return new Promise((resolve) => {
      const started = performance.now();
      let settled = false;
      const finish = (result: ChatCallResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const transport = target.protocol === "https:" ? https : http;
      const request = transport.request(
        target,
        {
          method: "POST",
          timeout: this.timeoutMs,
          headers: { "User-Agent": "memtrace-chat/1", "Content-Type": "application/json", Accept: "application/json", "Content-Length": Buffer.byteLength(payload) },
          lookup: guardedLookup(this.allowPrivateNetworks),
        },
        (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > this.maxResponseBytes) {
              finish(failure(`Response is larger than ${this.maxResponseBytes} bytes`));
              request.destroy();
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => {
            let parsed: unknown = null;
            try {
              parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            } catch {
              parsed = null;
            }
            finish({ httpStatus: response.statusCode ?? null, body: parsed, latencyMs: Math.round(performance.now() - started), error: null });
          });
          response.on("error", (error) => finish(failure(error.message)));
        },
      );
      request.on("timeout", () => {
        finish(failure(`No response in ${this.timeoutMs} ms`));
        request.destroy();
      });
      request.on("error", (error: NodeJS.ErrnoException) => finish(failure(error.code === "ECONNREFUSED" ? "Connection refused" : error.message)));
      request.end(payload);
    });
  }
}
