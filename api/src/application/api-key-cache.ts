import { createHash } from "node:crypto";

export interface ApiKeyAccess {
  experimentId: string;
  serviceName: string;
  createdByUserId: string;
}

/** Resuelve una API key en claro al experimento al que da acceso, o `null` si no existe o está revocada. */
export type ApiKeyResolver = (plaintext: string) => Promise<ApiKeyAccess | null>;

export interface ApiKeyCacheOptions {
  /** Cuánto se reutiliza una key ya validada sin volver a preguntar a la fuente de verdad. */
  ttlMs: number;
  /** Mientras la fuente falla, una key validada hace menos de esto se sigue aceptando. Debe ser ≥ `ttlMs`. */
  staleMs: number;
  /** Tope de keys recordadas: si se supera, se olvida la más antigua. */
  maxEntries: number;
  /** Tras un fallo de la fuente no se vuelve a intentar durante este tiempo: así no cada petición espera al tiempo de espera. */
  failureBackoffMs?: number;
  now?: () => number;
}

/**
 * Recuerda unos segundos las API keys ya validadas (ADR-098). Evita una consulta a Postgres por cada petición de ingesta
 * y hace que una caída de Postgres no pare la ingesta: mientras falla, las keys validadas hace poco siguen valiendo.
 *
 * Límites que hay que conocer:
 * - Una key revocada puede seguir valiendo hasta `ttlMs` (y hasta `staleMs` si Postgres está caído en ese momento). La
 *   revocación sigue decidiéndose en Postgres; esto solo la retrasa.
 * - Una key desconocida o revocada nunca se recuerda, y si Postgres falla se rechaza (no hay nada con qué aceptarla).
 * - Solo se guardan los aciertos. Los fallos de keys inválidas los frena el límite por origen del gateway (ADR-092).
 *
 * La key en claro no se guarda: se indexa por su hash.
 */
export class CachedApiKeyResolver {
  private readonly entries = new Map<string, { access: ApiKeyAccess; at: number }>();
  /** Varias peticiones con la misma key que caduca a la vez comparten una sola consulta. */
  private readonly inflight = new Map<string, Promise<ApiKeyAccess | null>>();
  private readonly now: () => number;
  private sourceDown?: { until: number; error: unknown };

  constructor(
    private readonly source: ApiKeyResolver,
    private readonly options: ApiKeyCacheOptions,
  ) {
    if (options.ttlMs < 0 || options.staleMs < options.ttlMs) throw new Error("staleMs must be >= ttlMs and both non-negative");
    if (!Number.isInteger(options.maxEntries) || options.maxEntries < 1) throw new Error("maxEntries must be a positive integer");
    this.now = options.now ?? Date.now;
  }

  readonly resolve: ApiKeyResolver = async (plaintext) => {
    const id = createHash("sha256").update(plaintext).digest("hex");
    const cached = this.entries.get(id);
    const at = this.now();
    if (cached && at - cached.at < this.options.ttlMs) return cached.access;

    // la fuente falló hace poco: sin reintentar, se sirve lo recordado o se rechaza enseguida
    if (this.sourceDown && at < this.sourceDown.until) {
      if (cached && at - cached.at < this.options.staleMs) return cached.access;
      throw this.sourceDown.error;
    }

    let pending = this.inflight.get(id);
    if (!pending) {
      pending = this.source(plaintext).finally(() => this.inflight.delete(id));
      this.inflight.set(id, pending);
    }
    try {
      const access = await pending;
      this.sourceDown = undefined;
      if (access) this.remember(id, access, at);
      else this.entries.delete(id);
      return access;
    } catch (error) {
      this.sourceDown = { until: this.now() + (this.options.failureBackoffMs ?? 5_000), error };
      if (cached && at - cached.at < this.options.staleMs) return cached.access;
      throw error;
    }
  };

  private remember(id: string, access: ApiKeyAccess, at: number) {
    this.entries.delete(id); // reinsertar la mueve al final: el primero de la lista es el más antiguo
    if (this.entries.size >= this.options.maxEntries) this.entries.delete(this.entries.keys().next().value as string);
    this.entries.set(id, { access, at });
  }
}
