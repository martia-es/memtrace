/**
 * Semáforo: limita las consultas simultáneas al almacén. Un endpoint como `overview` lanza varias
 * consultas a la vez; sin límite, unos pocos usuarios del dashboard pueden agotar los hilos de un
 * ClickHouse pequeño (en el clúster local, ~16 hilos de margen).
 */
export class QueryLimiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) throw new Error("maxConcurrent must be >= 1");
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}
