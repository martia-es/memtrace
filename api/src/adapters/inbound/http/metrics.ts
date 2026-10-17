/**
 * Registro mínimo de métricas en el formato de texto de Prometheus (ADR-098). Lo suficiente para el servicio `ingest`
 * (contadores, gauges e histogramas con etiquetas) sin añadir una dependencia a la cadena de suministro.
 */
type Labels = Record<string, string>;

const NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;

function escapeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

/** Clave estable de un conjunto de etiquetas: sus nombres van en orden para que {a,b} y {b,a} cuenten como la misma serie. */
function seriesKey(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}="${escapeValue(labels[k]!)}"`)
    .join(",");
}

function line(name: string, key: string, value: number): string {
  return `${name}${key ? `{${key}}` : ""} ${Number.isInteger(value) ? value : value.toString()}`;
}

interface Collectable {
  render(): string[];
}

abstract class Metric implements Collectable {
  constructor(
    protected readonly name: string,
    protected readonly help: string,
    private readonly type: "counter" | "gauge" | "histogram",
  ) {
    if (!NAME.test(name)) throw new Error(`invalid metric name: ${name}`);
  }
  protected abstract samples(): string[];
  render(): string[] {
    return [`# HELP ${this.name} ${this.help.replace(/\\/g, "\\\\").replace(/\n/g, "\\n")}`, `# TYPE ${this.name} ${this.type}`, ...this.samples()];
  }
}

export class Counter extends Metric {
  private readonly values = new Map<string, number>();
  constructor(name: string, help: string) {
    super(name, help, "counter");
  }
  inc(labels: Labels = {}, by = 1): void {
    if (by < 0) throw new Error("a counter cannot decrease");
    const key = seriesKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + by);
  }
  protected samples(): string[] {
    // un contador sin ninguna serie se publica a 0: así `rate()` y las alertas ven la métrica desde el primer scrape
    if (this.values.size === 0) return [line(this.name, "", 0)];
    return [...this.values].map(([key, value]) => line(this.name, key, value));
  }
}

export class Gauge extends Metric {
  private readonly values = new Map<string, number>();
  constructor(
    name: string,
    help: string,
    /** Si se da, el valor se calcula en cada scrape en vez de guardarse. */
    private readonly collect?: () => number,
  ) {
    super(name, help, "gauge");
  }
  set(value: number, labels: Labels = {}): void {
    this.values.set(seriesKey(labels), value);
  }
  protected samples(): string[] {
    if (this.collect) return [line(this.name, "", this.collect())];
    return [...this.values].map(([key, value]) => line(this.name, key, value));
  }
}

export class Histogram extends Metric {
  private readonly series = new Map<string, { counts: number[]; sum: number; count: number }>();
  constructor(
    name: string,
    help: string,
    private readonly buckets: number[],
  ) {
    super(name, help, "histogram");
    if (buckets.length === 0 || buckets.some((b, i) => i > 0 && b <= buckets[i - 1]!)) throw new Error("buckets must be increasing");
  }
  observe(value: number, labels: Labels = {}): void {
    const key = seriesKey(labels);
    let s = this.series.get(key);
    if (!s) {
      s = { counts: this.buckets.map(() => 0), sum: 0, count: 0 };
      this.series.set(key, s);
    }
    this.buckets.forEach((le, i) => {
      if (value <= le) s!.counts[i]! += 1;
    });
    s.sum += value;
    s.count += 1;
  }
  protected samples(): string[] {
    const out: string[] = [];
    const entries = this.series.size ? [...this.series] : [["", { counts: this.buckets.map(() => 0), sum: 0, count: 0 }] as const];
    for (const [key, s] of entries) {
      const prefix = key ? `${key},` : "";
      this.buckets.forEach((le, i) => out.push(line(`${this.name}_bucket`, `${prefix}le="${le}"`, s.counts[i]!)));
      out.push(line(`${this.name}_bucket`, `${prefix}le="+Inf"`, s.count));
      out.push(line(`${this.name}_sum`, key, s.sum));
      out.push(line(`${this.name}_count`, key, s.count));
    }
    return out;
  }
}

export class MetricsRegistry {
  private readonly metrics: Collectable[] = [];

  counter(name: string, help: string): Counter {
    return this.add(new Counter(name, help));
  }
  gauge(name: string, help: string, collect?: () => number): Gauge {
    return this.add(new Gauge(name, help, collect));
  }
  histogram(name: string, help: string, buckets: number[]): Histogram {
    return this.add(new Histogram(name, help, buckets));
  }

  /** Cuerpo de `/metrics` (formato de texto 0.0.4). */
  render(): string {
    return this.metrics.flatMap((m) => m.render()).join("\n") + "\n";
  }

  private add<T extends Collectable>(metric: T): T {
    this.metrics.push(metric);
    return metric;
  }
}

export const METRICS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";
