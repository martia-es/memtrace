import { describe, expect, it } from "vitest";
import type { AnnotationService } from "@/application/annotation-service";
import { PromptFailureService } from "@/application/prompt-failure-service";
import type { ScoreRepository } from "@/application/ports/score-repository";
import type { TraceRepository } from "@/application/ports/trace-repository";
import type { UserFeedbackRepository } from "@/application/ports/user-feedback-repository";
import { isLowScore } from "@/domain/prompt-failure";
import type { TraceSummary } from "@/domain/trace";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const summary = (traceId: string, overrides: Partial<TraceSummary> = {}): TraceSummary => ({
  traceId, rootSpanName: "chat", serviceName: "svc", startTimeUs: NOW * 1000, durationMs: 10, status: "ok", spanCount: 1, errorCount: 0, totalTokens: 0,
  input: `question ${traceId}`, output: "answer", error: null, conversationId: null, revision: null, prompts: [{ name: "p", version: 1 }], ...overrides,
});

function build(items: TraceSummary[], signals: { scores?: Array<{ traceId: string; dataType: string; value: string }>; down?: string[]; low?: string[] }) {
  const calls: unknown[] = [];
  const traces = { listTraces: async (q: unknown) => (calls.push(q), { items, nextCursor: null }) } as unknown as TraceRepository;
  const scores = { listScoresByTraces: async () => signals.scores ?? [] } as unknown as ScoreRepository;
  const feedback = { listForTraces: async () => (signals.down ?? []).map((traceId) => ({ traceId, rating: -1 })) } as unknown as UserFeedbackRepository;
  const annotations = { listRatings: async () => (signals.low ?? []).map((id) => ({ id, labels: 1, low: true })) } as unknown as AnnotationService;
  return { service: new PromptFailureService(traces, scores, feedback, annotations, () => NOW), calls };
}

describe("PromptFailureService", () => {
  it("collects the four failure signals, keeping every reason of each trace", async () => {
    const { service, calls } = build(
      [summary("a", { errorCount: 1, error: "429" }), summary("b"), summary("c"), summary("d"), summary("e")],
      { scores: [{ traceId: "b", dataType: "boolean", value: "false" }, { traceId: "a", dataType: "numeric", value: "0.2" }], down: ["c", "a"], low: ["d"] },
    );
    const result = await service.list("exp", "svc", "p", {});
    expect(calls[0]).toMatchObject({ service: "svc", promptName: "p" });
    expect(result.scanned).toBe(5);
    expect(result.items.map((i) => [i.traceId, i.reasons])).toEqual([
      ["a", ["error", "low_score", "user_dislike"]],
      ["b", ["low_score"]],
      ["c", ["user_dislike"]],
      ["d", ["human_low"]],
    ]);
    expect(result.counts).toEqual({ error: 1, low_score: 2, human_low: 1, user_dislike: 2 });
  });

  it("returns nothing for healthy traces", async () => {
    const { service } = build([summary("a")], { scores: [{ traceId: "a", dataType: "boolean", value: "true" }] });
    expect(await service.list("exp", "svc", "p", {})).toEqual({ items: [], scanned: 1, counts: { error: 0, low_score: 0, human_low: 0, user_dislike: 0 } });
  });
});

describe("isLowScore", () => {
  it("is a boolean No or a 0-1 number under 0.5; categorical never counts", () => {
    expect(isLowScore({ dataType: "boolean", value: "false" })).toBe(true);
    expect(isLowScore({ dataType: "boolean", value: "true" })).toBe(false);
    expect(isLowScore({ dataType: "numeric", value: "0.49" })).toBe(true);
    expect(isLowScore({ dataType: "numeric", value: "0.5" })).toBe(false);
    expect(isLowScore({ dataType: "numeric", value: "-3" })).toBe(false);
    expect(isLowScore({ dataType: "categorical", value: "bad" })).toBe(false);
  });
});
