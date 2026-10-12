import { describe, expect, it } from "vitest";
import type { AlertRuleDto, AlertRuleWithStatusDto, BudgetViewDto } from "@contract";
import { budgetGoalOf, goalOf, limitText, missingStarterGoals, starterRuleBody, STARTER_GOALS } from "@/domain/goals";

const rule = (over: Partial<AlertRuleDto> = {}): AlertRuleDto => ({
  id: "r1", experimentId: "exp-1", name: "Errors goal", metric: "error_rate", customMetricId: null, comparator: "above", threshold: 3, windowMinutes: 1440,
  minSamples: 10, reminderMinutes: null, recipients: [], enabled: true, createdAt: "", updatedAt: "", ...over,
});
const withStatus = (r: AlertRuleDto, state: "ok" | "firing" | "no_data" | null, lastValue: number | null = null): AlertRuleWithStatusDto => ({
  rule: r,
  status: state ? { state, since: "", lastValue, lastCheckedAt: null, lastNotifiedAt: null } : null,
});
const budget = (percent: number, over: Partial<BudgetViewDto["budget"]> = {}): BudgetViewDto => ({
  budget: { experimentId: "exp-1", monthlyUsd: 100, warnPercent: 80, recipients: [], enabled: true, updatedAt: "", ...over }, month: "2026-10-01", spentUsd: percent, percent, projectedUsd: null,
});

describe("goalOf", () => {
  it("is null when there is no active rule for the metric", () => {
    expect(goalOf("error_rate", [])).toBeNull();
    expect(goalOf("error_rate", [withStatus(rule({ enabled: false }), "ok", 1)])).toBeNull();
    expect(goalOf("error_rate", [withStatus(rule({ comparator: "below" }), "ok", 1)])).toBeNull();
    expect(goalOf("latency_p95", [withStatus(rule(), "ok", 1)])).toBeNull();
  });
  it("is green under 90 % of the limit, amber from 90 % and red when the evaluator says firing", () => {
    expect(goalOf("error_rate", [withStatus(rule(), "ok", 1.8)])).toMatchObject({ tone: "ok", label: "On track" });
    expect(goalOf("error_rate", [withStatus(rule(), "ok", 2.7)])).toMatchObject({ tone: "warn", label: "Close" });
    expect(goalOf("error_rate", [withStatus(rule(), "firing", 7)])).toMatchObject({ tone: "error", label: "Over goal", current: 7 });
  });
  it("stays neutral, never green, without a check or without enough data", () => {
    expect(goalOf("error_rate", [withStatus(rule(), null)])).toMatchObject({ tone: "neutral", label: "Waiting for first check" });
    expect(goalOf("error_rate", [withStatus(rule(), "no_data")])).toMatchObject({ tone: "neutral", label: "Not enough data" });
  });
});

describe("budgetGoalOf", () => {
  it("is null without a budget or with a paused one", () => {
    expect(budgetGoalOf(null)).toBeNull();
    expect(budgetGoalOf(budget(10, { enabled: false }))).toBeNull();
  });
  it("turns amber when the forecast passes the budget even if the spend is low", () => {
    expect(budgetGoalOf({ ...budget(40), projectedUsd: 120 })).toMatchObject({ tone: "warn", label: "Forecast over", projectedUsd: 120 });
    expect(budgetGoalOf({ ...budget(40), projectedUsd: 90 })).toMatchObject({ tone: "ok" });
  });
  it("uses the budget's own warning percentage for amber and 100 % for red", () => {
    expect(budgetGoalOf(budget(40))).toMatchObject({ tone: "ok" });
    expect(budgetGoalOf(budget(85))).toMatchObject({ tone: "warn" });
    expect(budgetGoalOf(budget(100))).toMatchObject({ tone: "error", label: "Over goal" });
  });
});

describe("starter goals", () => {
  it("proposes the two that are missing and builds rules over the last 24 h", () => {
    expect(missingStarterGoals([])).toHaveLength(2);
    expect(missingStarterGoals([withStatus(rule(), "ok", 1)]).map((g) => g.metric)).toEqual(["latency_p95"]);
    expect(starterRuleBody(STARTER_GOALS[0]!)).toMatchObject({ metric: "error_rate", comparator: "above", threshold: 3, windowMinutes: 1440, enabled: true });
  });
  it("writes limits in plain words", () => {
    expect(limitText("error_rate", 3)).toBe("under 3 %");
    expect(limitText("latency_p95", 5000)).toBe("under 5 s");
    expect(limitText("latency_p95", 800)).toBe("under 800 ms");
  });
});
