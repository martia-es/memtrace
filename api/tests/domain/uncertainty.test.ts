import { describe, expect, it } from "vitest";
import { signalsDisagree, uncertainty, type EpisodeSignals } from "@/domain/uncertainty";

const sig = (over: Partial<EpisodeSignals>): EpisodeSignals => ({ value: 0, thumbs: 0, evalScore: null, hasError: false, reasons: [], ...over });

describe("uncertainty", () => {
  it("es máxima en el centro de la zona «suspect»", () => {
    expect(uncertainty(sig({ value: 0.45 }))).toBe(1);
  });

  it("es 0 en un éxito o un fallo evidentes", () => {
    expect(uncertainty(sig({ value: 0 }))).toBe(0);
    expect(uncertainty(sig({ value: 0.9 }))).toBe(0);
    expect(uncertainty(sig({ value: 2.4, hasError: true }))).toBe(0);
  });

  it("baja linealmente al alejarse del centro", () => {
    expect(uncertainty(sig({ value: 0.3 }))).toBeCloseTo(0.667, 2);
    expect(uncertainty(sig({ value: 0.6 }))).toBeCloseTo(0.667, 2);
    expect(uncertainty(sig({ value: 0.15 }))).toBeCloseTo(0.333, 2);
  });

  it("sube cuando las señales se contradicen, sin pasar de 1", () => {
    // evaluador OK pero el usuario dio 👎: en el worker value = -0.2 + 0.6 = 0.4
    const contradictory = sig({ value: 0.4, thumbs: -1, evalScore: 1 });
    expect(signalsDisagree(contradictory)).toBe(true);
    expect(uncertainty(contradictory)).toBe(1);
    // mismo value sin contradicción puntúa menos
    expect(uncertainty(sig({ value: 0.15, thumbs: -1, evalScore: 1 }))).toBeGreaterThan(uncertainty(sig({ value: 0.15 })));
  });

  it("detecta los tres desacuerdos", () => {
    expect(signalsDisagree(sig({ evalScore: 1, hasError: true }))).toBe(true);
    expect(signalsDisagree(sig({ evalScore: 0, thumbs: 1 }))).toBe(true);
    expect(signalsDisagree(sig({ reasons: ["thumbs_mixed"] }))).toBe(true);
    expect(signalsDisagree(sig({ evalScore: 1, thumbs: 1 }))).toBe(false);
  });
});
