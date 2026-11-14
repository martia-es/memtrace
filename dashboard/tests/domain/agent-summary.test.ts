import type { AlertsOverviewDto, ErrorOverviewResponse, OverviewResponse } from "@contract";
import { describe, expect, it } from "vitest";
import { buildAgentSummary, periodRange, type AgentSummaryInput } from "@/domain/agent-summary";

const overview = (traces: number, errorTraces: number, costUsd = 0): OverviewResponse =>
  ({ totals: { traces, errorTraces, errorRate: traces ? errorTraces / traces : 0, costUsd } }) as OverviewResponse;

const rule = (name: string, state: "ok" | "firing", metric: "error_rate" | "cost" = "error_rate") =>
  ({ rule: { id: name, name, metric }, status: { state } }) as unknown as AlertsOverviewDto["rules"][number];

const alerts = (rules: AlertsOverviewDto["rules"], over: Partial<AlertsOverviewDto> = {}): AlertsOverviewDto => ({
  rules, events: [], budget: null, monthCost: { month: "2026-11-01", spentUsd: 38.72, projectedUsd: 82, daily: [] }, ...over,
});

const base: AgentSummaryInput = { period: periodRange("7d"), overview: null, previousOverview: null, previousSecurityEvents: null, alerts: null, security: null, errors: null, runs: null, deploys: null, environmentOf: {} };
const build = (over: Partial<AgentSummaryInput>) => buildAgentSummary({ ...base, ...over });

describe("buildAgentSummary", () => {
  it("says healthy when almost nothing failed and no alert fires", () => {
    const s = build({ overview: overview(1000, 20), alerts: alerts([rule("errors", "ok")]) });
    expect(s.health?.tone).toBe("ok");
    expect(s.cards.find((c) => c.id === "reliability")?.value).toBe("98.0%");
    expect(s.cards.find((c) => c.id === "alerts")?.tone).toBe("ok");
  });

  it("a firing alert makes the health an error and names the rule", () => {
    const s = build({ overview: overview(1000, 20), alerts: alerts([rule("Tool error rate", "firing")]) });
    expect(s.health?.tone).toBe("error");
    expect(s.health?.text).toContain("Tool error rate");
    expect(s.cards.find((c) => c.id === "reliability")?.tone).toBe("error");
  });

  it("does not pass a verdict on a small sample", () => {
    expect(build({ overview: overview(5, 5) }).health?.tone).toBe("neutral");
  });

  it("warns when the failure rate is above 5%", () => {
    expect(build({ overview: overview(1000, 80) }).health?.tone).toBe("warn");
  });

  it("colours the cost by the budget threshold", () => {
    const budget = { budget: { monthlyUsd: 95, warnPercent: 80, enabled: true }, percent: 85, spentUsd: 80, projectedUsd: null, month: "2026-11-01" } as AlertsOverviewDto["budget"];
    expect(build({ period: periodRange("month"), overview: overview(10, 0, 80), alerts: alerts([], { budget }) }).cards.find((c) => c.id === "cost")?.tone).toBe("warn");
  });

  it("leaves out the parts that did not load", () => {
    expect(build({}).cards).toEqual([]);
    expect(build({}).health).toBeNull();
  });

  it("orders the timeline newest first and ignores events outside the period", () => {
    const now = Date.now();
    const iso = (hoursAgo: number) => new Date(now - hoursAgo * 3_600_000).toISOString();
    const s = build({
      alerts: alerts([rule("errors", "ok")], { events: [{ id: "e1", experimentId: "exp-1", ruleId: "errors", at: iso(2), kind: "fired", value: 3.4, threshold: 3, emailed: 1 }, { id: "e0", experimentId: "exp-1", ruleId: "errors", at: iso(24 * 30), kind: "fired", value: 5, threshold: 3, emailed: 0 }] }),
      deploys: [{ id: "d1", deploymentId: "dep", commitSha: "3a08213f9b1c", ref: "main", requestedBy: null, status: "succeeded", gateVerdict: "allowed", gateBypassed: false, bypassReason: null, providerRunUrl: null, error: null, createdAt: iso(30), finishedAt: iso(29) }],
      environmentOf: { dep: "Production" },
    });
    expect(s.events.map((e) => e.id)).toEqual(["alert-e1", "deploy-d1"]);
    expect(s.events[1]!.title).toContain("3a08213");
  });

  it("ranks the causes and compares them with the previous period", () => {
    const category = (id: string, occurrences: number, previousOccurrences: number) => ({ id, title: id, occurrences, previousOccurrences });
    const errors = { previousRange: { from: "", to: "" }, totals: { occurrences: 100 }, categories: [category("a", 60, 0), category("b", 30, 60), category("c", 10, 10)] } as unknown as ErrorOverviewResponse;
    expect(build({ errors }).causes.map((c) => [c.id, c.share, c.trend])).toEqual([["a", 60, "new"], ["b", 30, "down"], ["c", 10, "flat"]]);
  });

  it("the budget and the forecast only apply to the current month", () => {
    const budget = { budget: { monthlyUsd: 95, warnPercent: 80, enabled: true }, percent: 85, spentUsd: 80, projectedUsd: 100, month: "2026-11-01" } as AlertsOverviewDto["budget"];
    const cost = build({ period: periodRange("30d"), overview: overview(10, 0, 12.5), alerts: alerts([], { budget }) }).cards.find((c) => c.id === "cost");
    expect(cost?.value).toBe("$12.50");
    expect(cost?.tone).toBe("neutral");
    expect(cost?.sub).toBe("");
  });

  it("compares reliability, cost and security with the previous period", () => {
    const s = build({
      overview: overview(1000, 20, 30),
      previousOverview: overview(1000, 60, 20),
      security: { days: 7, events: { total: 5, blocked: 0 } } as never,
      previousSecurityEvents: 9,
    });
    const delta = (id: string) => s.cards.find((c) => c.id === id)?.delta;
    expect(delta("reliability")).toMatchObject({ tone: "ok" });
    expect(delta("reliability")?.text).toContain("4.0 pp");
    expect(delta("cost")).toMatchObject({ tone: "neutral" });
    expect(delta("cost")?.text).toContain("50%");
    expect(delta("security")).toMatchObject({ tone: "ok" });
  });

  it("says nothing about the change when the previous period has no data", () => {
    const s = build({ overview: overview(1000, 20, 30), previousOverview: overview(0, 0, 0) });
    expect(s.cards.find((c) => c.id === "reliability")?.delta).toBeNull();
    expect(s.cards.find((c) => c.id === "cost")?.delta).toBeNull();
  });
});

describe("periodRange", () => {
  const now = new Date("2026-11-14T12:00:00.000Z");

  it("this month runs from the 1st (UTC) to now and is compared with the same days of the month before", () => {
    const r = periodRange("month", now);
    expect(r.from.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(r.previousFrom.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(r.previousTo.getTime() - r.previousFrom.getTime()).toBe(now.getTime() - r.from.getTime());
    expect(r.days).toBe(14);
  });

  it("a rolling period is compared with the span of the same length right before", () => {
    const r = periodRange("30d", now);
    expect(r.days).toBe(30);
    expect(r.previousTo.getTime()).toBe(r.from.getTime());
    expect(r.from.getTime() - r.previousFrom.getTime()).toBe(30 * 86_400_000);
  });

  it("never covers less than one day", () => {
    expect(periodRange("month", new Date("2026-11-01T00:30:00.000Z")).days).toBe(1);
  });
});
