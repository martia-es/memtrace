/**
 * Límite de peticiones por clave en ventana fija (ADR-081). Vive en memoria de cada réplica: con N réplicas el límite
 * efectivo es N veces mayor, y se reinicia al reiniciar el pod. Es una defensa contra abuso y errores de configuración
 * (un agente en un bucle), no una cuota de facturación.
 */
export interface RateDecision {
  allowed: boolean;
  /** segundos hasta que la ventana se reinicia (para `Retry-After`) */
  retryAfterSeconds: number;
  remaining: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 10_000,
  ) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");
    if (!Number.isInteger(windowMs) || windowMs < 1) throw new Error("windowMs must be a positive integer");
  }

  /** Cuenta una petición. */
  hit(key: string): RateDecision {
    const at = this.now();
    const w = this.current(key, at);
    w.count += 1;
    return this.decide(w, at);
  }

  /** Mira sin contar (para bloquear antes de gastar una consulta). */
  peek(key: string): RateDecision {
    const at = this.now();
    return this.decide(this.current(key, at), at);
  }

  private current(key: string, at: number) {
    let w = this.windows.get(key);
    if (!w || at - w.start >= this.windowMs) {
      if (this.windows.size >= this.maxKeys) this.prune(at);
      w = { start: at, count: 0 };
      this.windows.set(key, w);
    }
    return w;
  }

  private decide(w: { start: number; count: number }, at: number): RateDecision {
    return {
      allowed: w.count <= this.limit,
      remaining: Math.max(this.limit - w.count, 0),
      retryAfterSeconds: Math.max(Math.ceil((w.start + this.windowMs - at) / 1000), 1),
    };
  }

  private prune(at: number) {
    for (const [key, w] of this.windows) if (at - w.start >= this.windowMs) this.windows.delete(key);
    // si siguen todas vigentes (ataque con claves distintas), se descarta lo más viejo en vez de crecer sin límite
    if (this.windows.size >= this.maxKeys) this.windows.delete(this.windows.keys().next().value as string);
  }
}
