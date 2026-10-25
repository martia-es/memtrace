import { describe, expect, it, vi } from "vitest";
import { AgentSecurityService } from "@/application/agent-security-service";
import type { IdentityRepository } from "@/application/ports/identity-repository";
import type { ScoreRepository } from "@/application/ports/score-repository";
import type { SecurityEventRepository } from "@/application/ports/security-event-repository";
import { buildSecurityEvents, summarizeRedTeamRun } from "@/domain/agent-security";
import { ValidationError } from "@/domain/errors";
import type { DatasetRunItemResult } from "@/domain/evaluation";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-25T12:00:00Z");
const scope = { experimentId: "exp-1", serviceName: "weather" };

const bool = (name: string, ok: boolean) => ({ name, value: String(ok), dataType: "boolean" as const, source: "code" as const, comment: null });
const category = (value: string) => ({ name: "attack_category", value, dataType: "categorical" as const, source: "code" as const, comment: null });
const item = (cat: string | null, scores: ReturnType<typeof bool>[], error: string | null = null, index = 0): DatasetRunItemResult => ({
  itemIndex: index, input: "x", expectedOutput: null, output: "y", traceId: null, error, scores: cat ? [...scores, category(cat)] : scores,
});
const run = (id: string, name: string, over: Record<string, unknown> = {}) => ({ id, datasetId: "ds-1", name, status: "completed", createdAt: `2026-10-${id.padStart(2, "0")}T10:00:00Z`, revision: "abc1234", ...over });

describe("buildSecurityEvents", () => {
  const rows = [
    { detector: "secret_leak", category: "secret_leak", severity: "error", action: "blocked", day: "2026-10-24", count: 2 },
    { detector: "tool_policy", category: "unauthorized_tool", severity: "warn", action: "warned", day: "2026-10-24", count: 3 },
    { detector: "tool_policy", category: "unauthorized_tool", severity: "error", action: "blocked", day: "2026-10-25", count: 1 },
  ];

  it("totals, counts blocked and groups by every dimension, biggest first", () => {
    const e = buildSecurityEvents(rows, 3, NOW);
    expect(e.total).toBe(6);
    expect(e.blocked).toBe(3);
    expect(e.byDetector).toEqual([{ detector: "tool_policy", count: 4 }, { detector: "secret_leak", count: 2 }]);
    expect(e.byCategory[0]).toEqual({ category: "unauthorized_tool", count: 4 });
    expect(e.bySeverity).toEqual([{ severity: "error", count: 3 }, { severity: "warn", count: 3 }]);
    expect(e.byAction).toEqual([{ action: "blocked", count: 3 }, { action: "warned", count: 3 }]);
  });

  it("fills the days of the period with zeros, oldest first", () => {
    expect(buildSecurityEvents(rows, 3, NOW).daily).toEqual([
      { date: "2026-10-23", count: 0 },
      { date: "2026-10-24", count: 5 },
      { date: "2026-10-25", count: 1 },
    ]);
  });

  it("is all zeros without events", () => {
    const e = buildSecurityEvents([], 2, NOW);
    expect(e).toMatchObject({ total: 0, blocked: 0, byDetector: [], daily: [{ date: "2026-10-24", count: 0 }, { date: "2026-10-25", count: 0 }] });
  });
});

describe("summarizeRedTeamRun", () => {
  const meta = { id: "r1", datasetId: "ds-1", name: "redteam/weather", createdAt: "2026-10-25T10:00:00Z", revision: null };

  it("counts an attack as successful when ANY boolean score is false, per category, worst first", () => {
    const s = summarizeRedTeamRun(meta, [
      item("jailbreak", [bool("attack_resisted", true), bool("no_secret_leak", true)], null, 0),
      item("jailbreak", [bool("attack_resisted", true), bool("no_secret_leak", false)], null, 1),
      item("prompt_injection", [bool("attack_resisted", false)], null, 2),
      item("prompt_injection", [bool("attack_resisted", false)], null, 3),
    ]);
    expect(s.items).toBe(4);
    expect(s.attacksSucceeded).toBe(3);
    expect(s.asr).toBe(0.75);
    expect(s.byCategory).toEqual([
      { category: "prompt_injection", items: 2, attacksSucceeded: 2, asr: 1 },
      { category: "jailbreak", items: 2, attacksSucceeded: 1, asr: 0.5 },
    ]);
  });

  it("leaves errored items out of the ASR and counts them apart; items without a category are 'uncategorized'", () => {
    const s = summarizeRedTeamRun(meta, [item("jailbreak", [], "boom", 0), item(null, [bool("attack_resisted", true)], null, 1), item("jailbreak", [], null, 2)]);
    expect(s).toMatchObject({ items: 1, errored: 1, attacksSucceeded: 0, asr: 0 });
    expect(s.byCategory).toEqual([{ category: "uncategorized", items: 1, attacksSucceeded: 0, asr: 0 }]);
  });

  it("has no ASR when nothing was evaluated", () => {
    expect(summarizeRedTeamRun(meta, []).asr).toBeNull();
  });
});

describe("AgentSecurityService", () => {
  function setup(runs: ReturnType<typeof run>[], results: Record<string, DatasetRunItemResult[]> = {}) {
    const identity = { listRunsForExperiment: vi.fn().mockResolvedValue(runs) } as unknown as IdentityRepository;
    const scores = { listScoresByRun: vi.fn(async (_s, id: string) => results[id] ?? []) } as unknown as ScoreRepository;
    const events: SecurityEventRepository = { countEvents: vi.fn().mockResolvedValue([]) };
    return { service: new AgentSecurityService(identity, scores, events, () => NOW), events, scores };
  }

  it("reads the events of the period under the tenant scope", async () => {
    const { service, events } = setup([]);
    const posture = await service.posture(scope, { days: 7 });
    expect(events.countEvents).toHaveBeenCalledWith({ fromMs: NOW - 7 * DAY, toMs: NOW, scope });
    expect(posture.days).toBe(7);
    expect(posture.events.daily).toHaveLength(7);
    expect(posture.redteam.runs).toEqual([]);
  });

  it("only looks at completed redteam/ runs, newest first, at most ten", async () => {
    const runs = [
      ...Array.from({ length: 12 }, (_, i) => run(String(i + 1), "redteam/weather")),
      run("20", "weather-regression"),
      run("21", "redteam/weather", { status: "running" }),
    ];
    const { service, scores } = setup(runs);
    const posture = await service.posture(scope, { days: 30 });
    expect(posture.redteam.runs.map((r) => r.runId)).toEqual(["12", "11", "10", "9", "8", "7", "6", "5", "4", "3"]);
    expect(scores.listScoresByRun).toHaveBeenCalledTimes(10);
    expect(posture.redteam.runs[0]!.revision).toBe("abc1234");
    expect(posture.redteam.runs[0]!.datasetId).toBe("ds-1");
  });

  it("summarizes each run from its stored scores", async () => {
    const { service } = setup([run("1", "redteam/weather")], { "1": [item("jailbreak", [bool("attack_resisted", false)])] });
    expect((await service.posture(scope, { days: 30 })).redteam.runs[0]).toMatchObject({ items: 1, attacksSucceeded: 1, asr: 1 });
  });

  it.each([0, 366, 1.5, Number.NaN])("rejects days=%s before touching the store", async (days) => {
    const { service, events } = setup([]);
    await expect(service.posture(scope, { days })).rejects.toBeInstanceOf(ValidationError);
    expect(events.countEvents).not.toHaveBeenCalled();
  });
});
