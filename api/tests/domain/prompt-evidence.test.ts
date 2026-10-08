import { describe, expect, it } from "vitest";
import { toPricingCatalog } from "@/domain/pricing";
import { buildPromptEvidence, type PromptEvidenceRows, type VersionTraceRow } from "@/domain/prompt-evidence";

const range = { fromMs: 0, toMs: 1000 };
const pricing = toPricingCatalog([{ modelId: "gpt-4o", provider: "openai", inputPricePerToken: 0.000002, outputPricePerToken: 0.00001, source: "test", updatedAtMs: 0 }]);

const trace = (version: number, extra: Partial<VersionTraceRow> = {}): VersionTraceRow => ({
  version, traces: 100, conversations: 40, errorTraces: 10, p50Ms: 800, p95Ms: 2400, firstSeenMs: 10, lastSeenMs: 900, ...extra,
});
const rows = (extra: Partial<PromptEvidenceRows> = {}): PromptEvidenceRows => ({ traces: [], tokens: [], errors: [], feedback: [], evaluators: [], ...extra });
const errorGroup = (version: number, message: string, traces: number) => ({
  version, kind: "tool", name: "get_weather", message, exceptionType: "", exceptionMessage: "", occurrences: traces, traces, conversations: 0, firstSeenMs: 1, lastSeenMs: 2,
});

describe("buildPromptEvidence (ADR-069)", () => {
  it("returns only the versions with traffic, newest first, with the error rate", () => {
    const { versions } = buildPromptEvidence(rows({ traces: [trace(1), trace(3, { errorTraces: 0 }), trace(2, { traces: 50, errorTraces: 5 })] }), pricing, range);
    expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(versions.map((v) => v.errorRate)).toEqual([0, 0.1, 0.1]);
    expect(buildPromptEvidence(rows(), pricing, range).versions).toEqual([]);
  });

  it("prices the tokens of each model and gives the cost per trace", () => {
    const [v] = buildPromptEvidence(
      rows({ traces: [trace(1, { traces: 10 })], tokens: [{ version: 1, model: "gpt-4o", inputTokens: 1_000_000, outputTokens: 100_000 }] }),
      pricing,
      range,
    ).versions;
    expect(v!.costUsd).toBeCloseTo(3); // 1M × 2e-6 + 100k × 1e-5
    expect(v!.costPerTraceUsd).toBeCloseTo(0.3);
    expect(v!.costComplete).toBe(true);
    expect([v!.inputTokens, v!.outputTokens]).toEqual([1_000_000, 100_000]);
  });

  it("marks the cost as a minimum when some model has no known price, and as unknown when none has", () => {
    const partial = buildPromptEvidence(
      rows({ traces: [trace(1)], tokens: [{ version: 1, model: "gpt-4o", inputTokens: 1000, outputTokens: 0 }, { version: 1, model: "mystery-model", inputTokens: 5000, outputTokens: 0 }] }),
      pricing,
      range,
    ).versions[0]!;
    expect(partial.costUsd).toBeCloseTo(0.002);
    expect(partial.costComplete).toBe(false);

    const unknown = buildPromptEvidence(rows({ traces: [trace(1)], tokens: [{ version: 1, model: "mystery-model", inputTokens: 5000, outputTokens: 0 }] }), pricing, range).versions[0]!;
    expect(unknown.costUsd).toBeNull();
    expect(unknown.costPerTraceUsd).toBeNull();
  });

  it("keeps each version's tokens, errors, feedback and evaluators apart", () => {
    const { versions } = buildPromptEvidence(
      rows({
        traces: [trace(1), trace(2)],
        tokens: [{ version: 1, model: "gpt-4o", inputTokens: 100, outputTokens: 0 }, { version: 2, model: "gpt-4o", inputTokens: 900, outputTokens: 0 }],
        feedback: [{ version: 2, up: 9, down: 1, ratedTraces: 10 }],
        evaluators: [{ version: 1, name: "tone", dataType: "boolean", items: 20, average: 0.5 }, { version: 2, name: "tone", dataType: "boolean", items: 20, average: 0.9 }],
      }),
      pricing,
      range,
    );
    const [v2, v1] = versions;
    expect([v1!.inputTokens, v2!.inputTokens]).toEqual([100, 900]);
    expect(v1!.feedback).toEqual({ up: 0, down: 0, ratedTraces: 0, satisfaction: null });
    expect(v2!.feedback).toEqual({ up: 9, down: 1, ratedTraces: 10, satisfaction: 90 });
    expect([v1!.evaluators[0]!.value, v2!.evaluators[0]!.value]).toEqual([0.5, 0.9]);
  });

  it("names the failures in business language, worst first, at most three", () => {
    const [v] = buildPromptEvidence(
      rows({
        traces: [trace(1, { errorTraces: 30 })],
        errors: [
          errorGroup(1, "429 Too Many Requests", 12),
          errorGroup(1, "request timed out after 30s", 9),
          errorGroup(1, "HTTP 503 Service Unavailable", 6),
          errorGroup(1, "status 404 not found", 3),
          errorGroup(2, "401 Unauthorized", 99), // another version: must not leak into this one
        ],
      }),
      pricing,
      range,
    ).versions;
    expect(v!.errorCauses).toHaveLength(3);
    expect(v!.errorCauses.map((c) => c.id)).toEqual(expect.arrayContaining(["quota_exceeded", "timeout"]));
    expect(v!.errorCauses.map((c) => c.id)).not.toContain("access_denied");
    expect(v!.errorCauses[0]).toMatchObject({ title: expect.any(String), severity: expect.stringMatching(/high|medium|low/), traces: expect.any(Number) });
  });

  it("a version without failures has no causes", () => {
    const [v] = buildPromptEvidence(rows({ traces: [trace(1, { errorTraces: 0 })] }), pricing, range).versions;
    expect(v!.errorCauses).toEqual([]);
  });

  it("orders evaluators by name and keeps numeric and categorical ones", () => {
    const [v] = buildPromptEvidence(
      rows({
        traces: [trace(1)],
        evaluators: [
          { version: 1, name: "relevance", dataType: "numeric", items: 8, average: 4.2 },
          { version: 1, name: "category", dataType: "categorical", items: 8, average: null },
          { version: 1, name: "accurate", dataType: "boolean", items: 8, average: 0.75 },
        ],
      }),
      pricing,
      range,
    ).versions;
    expect(v!.evaluators.map((e) => [e.name, e.dataType, e.value])).toEqual([["accurate", "boolean", 0.75], ["category", "categorical", null], ["relevance", "numeric", 4.2]]);
  });
});
