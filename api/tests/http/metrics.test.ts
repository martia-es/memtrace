import { describe, expect, it } from "vitest";
import { MetricsRegistry } from "@/adapters/inbound/http/metrics";

describe("MetricsRegistry (Prometheus text format)", () => {
  it("renders counters with sorted, escaped labels", () => {
    const r = new MetricsRegistry();
    const c = r.counter("things_total", "Things.\nSecond line.");
    c.inc({ b: "2", a: 'x"y\\z\nw' });
    c.inc({ a: 'x"y\\z\nw', b: "2" }, 2); // las mismas etiquetas en otro orden son la misma serie
    expect(r.render()).toBe(['# HELP things_total Things.\\nSecond line.', "# TYPE things_total counter", 'things_total{a="x\\"y\\\\z\\nw",b="2"} 3', ""].join("\n"));
  });

  it("publishes an unused counter as 0, so rate() and alerts see it from the first scrape", () => {
    const r = new MetricsRegistry();
    r.counter("never_total", "Never.");
    expect(r.render()).toContain("never_total 0");
  });

  it("renders gauges, set and computed", () => {
    const r = new MetricsRegistry();
    r.gauge("fixed", "Fixed.").set(2.5, { k: "v" });
    r.gauge("computed", "Computed.", () => 7);
    const out = r.render();
    expect(out).toContain('fixed{k="v"} 2.5');
    expect(out).toContain("computed 7");
  });

  it("renders histograms with cumulative buckets, +Inf, sum and count", () => {
    const r = new MetricsRegistry();
    const h = r.histogram("lat_seconds", "Latency.", [0.1, 1]);
    h.observe(0.05, { code: "200" });
    h.observe(0.5, { code: "200" });
    h.observe(5, { code: "200" });
    const out = r.render();
    expect(out).toContain('lat_seconds_bucket{code="200",le="0.1"} 1');
    expect(out).toContain('lat_seconds_bucket{code="200",le="1"} 2');
    expect(out).toContain('lat_seconds_bucket{code="200",le="+Inf"} 3');
    expect(out).toContain('lat_seconds_sum{code="200"} 5.55');
    expect(out).toContain('lat_seconds_count{code="200"} 3');
  });

  it("renders an empty histogram with zeroed buckets", () => {
    const r = new MetricsRegistry();
    r.histogram("empty_seconds", "Empty.", [1]);
    expect(r.render()).toContain('empty_seconds_bucket{le="+Inf"} 0');
  });

  it("rejects invalid names, decreasing counters and unordered buckets", () => {
    const r = new MetricsRegistry();
    expect(() => r.counter("bad name", "x")).toThrow();
    expect(() => r.counter("ok_total", "x").inc({}, -1)).toThrow();
    expect(() => r.histogram("h", "x", [1, 1])).toThrow();
  });
});
