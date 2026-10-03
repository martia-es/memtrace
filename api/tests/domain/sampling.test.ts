import { describe, expect, it } from "vitest";
import { sampleWithSeed } from "@/domain/sampling";

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("sampleWithSeed (ADR-040)", () => {
  it("is reproducible: same list and seed give the same sample, another seed a different one", () => {
    const a = sampleWithSeed(range(100), 10, "seed-1");
    expect(sampleWithSeed(range(100), 10, "seed-1")).toEqual(a);
    expect(sampleWithSeed(range(100), 10, "seed-2")).not.toEqual(a);
  });

  it("returns distinct elements of the input, of the requested size", () => {
    const sample = sampleWithSeed(range(50), 20, "x");
    expect(sample).toHaveLength(20);
    expect(new Set(sample).size).toBe(20);
    expect(sample.every((n) => n >= 0 && n < 50)).toBe(true);
  });

  it("returns everything when asked for at least as many as exist, and nothing for zero or an empty list", () => {
    expect([...sampleWithSeed(range(5), 99, "x")].sort()).toEqual(range(5));
    expect(sampleWithSeed(range(5), 0, "x")).toEqual([]);
    expect(sampleWithSeed([], 3, "x")).toEqual([]);
  });

  it("does not mutate the input", () => {
    const input = range(10);
    sampleWithSeed(input, 5, "x");
    expect(input).toEqual(range(10));
  });

  it("is not biased toward the start of the list (every position gets picked over many seeds)", () => {
    const hits = new Array<number>(10).fill(0);
    for (let s = 0; s < 2000; s++) for (const n of sampleWithSeed(range(10), 3, `s${s}`)) hits[n]!++;
    // esperado 600 por posición (2000 · 3/10); un sesgo grave quedaría muy fuera de este margen
    for (const h of hits) expect(h).toBeGreaterThan(500), expect(h).toBeLessThan(700);
  });
});
