import { describe, expect, it } from "vitest";
import type { AgentSecurityDto } from "@contract";
import { asrTone, humanize, isUntouched, latestEvaluatedRun, parsePeriod, worstCategory } from "@/domain/agent-security";

const run = (over: Partial<AgentSecurityDto["redteam"]["runs"][number]> = {}) => ({
  runId: "r1", datasetId: "d1", name: "redteam/weather", createdAt: "2026-10-25T10:00:00Z", revision: null, items: 10, errored: 0, attacksSucceeded: 0, asr: 0, byCategory: [], ...over,
});
const posture = (runs: AgentSecurityDto["redteam"]["runs"], total = 0): AgentSecurityDto => ({
  days: 30, events: { total, blocked: 0, byDetector: [], byCategory: [], bySeverity: [], byAction: [], daily: [] }, redteam: { runs },
});

describe("agent security helpers", () => {
  it("accepts only the offered periods and falls back to 30 days", () => {
    expect(parsePeriod("7")).toBe(7);
    expect(parsePeriod(["90"])).toBe(90);
    expect(parsePeriod("15")).toBe(30);
    expect(parsePeriod(undefined)).toBe(30);
  });

  it("turns identifiers into readable labels", () => {
    expect(humanize("secret_leak")).toBe("Secret leak");
    expect(humanize("tool_policy")).toBe("Tool policy");
    expect(humanize("")).toBe("");
  });

  it("colors the attack success rate: none is green, up to 10 % warns, more is an error, unknown is neutral", () => {
    expect([asrTone(null), asrTone(0), asrTone(0.05), asrTone(0.1), asrTone(0.5)]).toEqual(["neutral", "ok", "warn", "error", "error"]);
  });

  it("picks the newest run that evaluated something", () => {
    const empty = run({ runId: "new", items: 0, asr: null });
    const older = run({ runId: "old" });
    expect(latestEvaluatedRun(posture([empty, older]))?.runId).toBe("old");
    expect(latestEvaluatedRun(posture([empty]))).toBeNull();
  });

  it("is untouched only without events and without runs", () => {
    expect(isUntouched(posture([]))).toBe(true);
    expect(isUntouched(posture([], 1))).toBe(false);
    expect(isUntouched(posture([run()]))).toBe(false);
  });

  it("reports the worst category only when some attack got through", () => {
    expect(worstCategory(run({ byCategory: [{ category: "jailbreak", items: 4, attacksSucceeded: 2, asr: 0.5 }] }))?.category).toBe("jailbreak");
    expect(worstCategory(run({ byCategory: [{ category: "jailbreak", items: 4, attacksSucceeded: 0, asr: 0 }] }))).toBeNull();
  });
});

describe("daily events chart", () => {
  it("draws one bar per day, labelled month-day, with the counts as values", async () => {
    const { dailyEventsOption } = await import("@/ui/security-chart-option");
    const option = dailyEventsOption([{ date: "2026-10-24", count: 5 }, { date: "2026-10-25", count: 0 }], false) as { xAxis: { data: string[] }; series: Array<{ type: string; data: number[] }> };
    expect(option.xAxis.data).toEqual(["10-24", "10-25"]);
    expect(option.series[0]).toMatchObject({ type: "bar", data: [5, 0] });
  });
});
