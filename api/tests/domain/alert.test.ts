import { describe, expect, it } from "vitest";
import { ValidationError } from "@/domain/errors";
import {
  MAX_RECIPIENTS,
  evaluateBudget,
  evaluateRule,
  formatAlertValue,
  monthKey,
  projectMonthEnd,
  validateAlertRule,
  validateCostBudget,
  validateRecipients,
  type AlertRule,
  type BudgetLevel,
  type PreviousStatus,
} from "@/domain/alert";

const UUID = "11111111-1111-4111-8111-111111111111";
const valid = { name: "Errors up", metric: "error_rate", comparator: "above", threshold: 5, windowMinutes: 15, recipients: ["Ops@Example.com"] };
const fieldsOf = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return Object.keys((error as ValidationError).fields);
  }
  throw new Error("should have thrown");
};

describe("validateAlertRule", () => {
  it("normalizes a valid rule: trims the name, lowercases and dedupes recipients, applies the defaults", () => {
    const rule = validateAlertRule({ ...valid, name: "  Errors up  ", recipients: ["Ops@Example.com", "ops@example.com", " a@b.io "] });
    expect(rule).toEqual({
      name: "Errors up",
      metric: "error_rate",
      customMetricId: null,
      comparator: "above",
      threshold: 5,
      windowMinutes: 15,
      minSamples: 20,
      reminderMinutes: null,
      recipients: ["ops@example.com", "a@b.io"],
      enabled: true,
    });
  });

  it("cost and custom rules need no minimum of samples", () => {
    expect(validateAlertRule({ ...valid, metric: "cost", threshold: 50, minSamples: 99 }).minSamples).toBe(0);
    expect(validateAlertRule({ ...valid, metric: "custom", customMetricId: UUID, threshold: 3 }).minSamples).toBe(0);
  });

  it("a custom rule must name its chart, and no other rule may", () => {
    expect(fieldsOf(() => validateAlertRule({ ...valid, metric: "custom", threshold: 3 }))).toContain("customMetricId");
    expect(fieldsOf(() => validateAlertRule({ ...valid, metric: "custom", customMetricId: "nope", threshold: 3 }))).toContain("customMetricId");
    expect(fieldsOf(() => validateAlertRule({ ...valid, customMetricId: UUID }))).toContain("customMetricId");
  });

  it.each([
    ["no name", { name: "   " }, "name"],
    ["a name that is too long", { name: "x".repeat(81) }, "name"],
    ["an unknown metric", { metric: "memory" }, "metric"],
    ["an unknown comparator", { comparator: "equal" }, "comparator"],
    ["a threshold that is not a number", { threshold: "5" }, "threshold"],
    ["NaN", { threshold: NaN }, "threshold"],
    ["an error rate over 100 %", { threshold: 120 }, "threshold"],
    ["a negative error rate", { threshold: -1 }, "threshold"],
    ["a window under 5 minutes", { windowMinutes: 4 }, "windowMinutes"],
    ["a window over a day", { windowMinutes: 1441 }, "windowMinutes"],
    ["a fractional window", { windowMinutes: 10.5 }, "windowMinutes"],
    ["a reminder under 15 minutes", { reminderMinutes: 5 }, "reminderMinutes"],
    ["zero minimum samples", { minSamples: 0 }, "minSamples"],
    ["enabled that is not a boolean", { enabled: "yes" }, "enabled"],
    ["a recipient that is not an email", { recipients: ["not-an-email"] }, "recipients"],
    ["recipients that are not a list", { recipients: "a@b.io" }, "recipients"],
  ])("refuses %s", (_name, patch, field) => {
    expect(fieldsOf(() => validateAlertRule({ ...valid, ...patch }))).toContain(field);
  });

  it("reports every wrong field at once, not only the first", () => {
    expect(fieldsOf(() => validateAlertRule({ name: "", metric: "x", comparator: "y", threshold: "z", windowMinutes: 1 }))).toEqual(
      expect.arrayContaining(["name", "metric", "comparator", "threshold", "windowMinutes"]),
    );
  });

  it("accepts latency and cost thresholds that would be nonsense as percentages", () => {
    expect(validateAlertRule({ ...valid, metric: "latency_p95", threshold: 2500 }).threshold).toBe(2500);
    expect(validateAlertRule({ ...valid, metric: "cost", threshold: 1234.5 }).threshold).toBe(1234.5);
    expect(fieldsOf(() => validateAlertRule({ ...valid, metric: "latency_p95", threshold: 0 }))).toContain("threshold");
  });
});

describe("validateRecipients", () => {
  it("allows up to ten and refuses an eleventh", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `p${i}@example.com`);
    expect(validateRecipients(many(MAX_RECIPIENTS))).toHaveLength(MAX_RECIPIENTS);
    expect(fieldsOf(() => validateRecipients(many(MAX_RECIPIENTS + 1)))).toContain("recipients");
  });

  it.each(["a@b", "@b.io", "a b@c.io", "a@b.io, c@d.io", "<script>@x.io", 'a"@b.io', "a@b.io\nBcc: x@y.io", ""])("refuses %j, including header-injection shapes", (bad) => {
    expect(() => validateRecipients([bad])).toThrow(ValidationError);
  });

  it("counts duplicates once, so the limit is on people, not on repeats", () => {
    expect(validateRecipients(Array(30).fill("a@b.io"))).toEqual(["a@b.io"]);
  });
});

describe("evaluateRule", () => {
  const rule: Pick<AlertRule, "comparator" | "threshold" | "minSamples" | "reminderMinutes"> = { comparator: "above", threshold: 5, minSamples: 20, reminderMinutes: null };
  const t0 = new Date("2026-10-10T10:00:00.000Z");
  const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);
  const firing = (over: Partial<PreviousStatus> = {}): PreviousStatus => ({ state: "firing", since: t0.toISOString(), lastValue: 9, lastNotifiedAt: t0.toISOString(), ...over });

  it("fires the first time the value crosses the threshold", () => {
    const result = evaluateRule(rule, { value: 8, samples: 100 }, null, t0);
    expect(result.event).toBe("fired");
    expect(result.status).toMatchObject({ state: "firing", since: t0.toISOString(), lastValue: 8 });
  });

  it("is strict: a value equal to the threshold does not fire", () => {
    expect(evaluateRule(rule, { value: 5, samples: 100 }, null, t0).event).toBeNull();
    expect(evaluateRule({ ...rule, comparator: "below" }, { value: 5, samples: 100 }, null, t0).event).toBeNull();
  });

  it("fires below the threshold for a 'below' rule", () => {
    expect(evaluateRule({ ...rule, comparator: "below", threshold: 70 }, { value: 60, samples: 50 }, null, t0).event).toBe("fired");
  });

  it("does not repeat while it stays firing, and keeps when it started", () => {
    const result = evaluateRule(rule, { value: 9, samples: 100 }, firing(), at(10));
    expect(result.event).toBeNull();
    expect(result.status).toMatchObject({ state: "firing", since: t0.toISOString(), lastValue: 9 });
  });

  it("resolves when a good measurement is back inside the threshold", () => {
    const result = evaluateRule(rule, { value: 2, samples: 100 }, firing(), at(10));
    expect(result.event).toBe("resolved");
    expect(result.status).toMatchObject({ state: "ok", since: at(10).toISOString() });
  });

  it("does not notify when it was already fine", () => {
    const prev: PreviousStatus = { state: "ok", since: t0.toISOString(), lastValue: 1, lastNotifiedAt: null };
    const result = evaluateRule(rule, { value: 2, samples: 100 }, prev, at(5));
    expect(result.event).toBeNull();
    expect(result.status.since).toBe(t0.toISOString());
  });

  describe("not enough data", () => {
    it("never fires on too few observations: two failed requests are not a 100 % error rate", () => {
      const result = evaluateRule(rule, { value: 100, samples: 2 }, null, t0);
      expect(result.event).toBeNull();
      expect(result.status.state).toBe("no_data");
    });

    it("treats a missing value the same way", () => {
      expect(evaluateRule(rule, { value: null, samples: 0 }, null, t0).status.state).toBe("no_data");
    });

    it("never resolves a firing alert just because the traffic stopped", () => {
      const result = evaluateRule(rule, { value: null, samples: 0 }, firing(), at(30));
      expect(result.event).toBeNull();
      expect(result.status).toMatchObject({ state: "firing", since: t0.toISOString(), lastValue: 9 });
    });

    it("keeps the time it has been without data", () => {
      const prev: PreviousStatus = { state: "no_data", since: t0.toISOString(), lastValue: null, lastNotifiedAt: null };
      expect(evaluateRule(rule, { value: null, samples: 0 }, prev, at(20)).status.since).toBe(t0.toISOString());
    });

    it("fires as soon as there is enough data again", () => {
      const prev: PreviousStatus = { state: "no_data", since: t0.toISOString(), lastValue: null, lastNotifiedAt: null };
      expect(evaluateRule(rule, { value: 9, samples: 50 }, prev, at(20)).event).toBe("fired");
    });

    it("a rule with no minimum (cost) trusts any value, zero included", () => {
      const cost = { ...rule, minSamples: 0, comparator: "below" as const, threshold: 1 };
      expect(evaluateRule(cost, { value: 0, samples: 0 }, null, t0).event).toBe("fired");
    });
  });

  describe("reminders", () => {
    const withReminder = { ...rule, reminderMinutes: 60 };

    it("reminds once the interval has passed since the last notice", () => {
      expect(evaluateRule(withReminder, { value: 9, samples: 100 }, firing(), at(59)).event).toBeNull();
      expect(evaluateRule(withReminder, { value: 9, samples: 100 }, firing(), at(60)).event).toBe("reminder");
    });

    it("counts from the last notice, not from when it started", () => {
      const prev = firing({ lastNotifiedAt: at(60).toISOString() });
      expect(evaluateRule(withReminder, { value: 9, samples: 100 }, prev, at(100)).event).toBeNull();
      expect(evaluateRule(withReminder, { value: 9, samples: 100 }, prev, at(120)).event).toBe("reminder");
    });

    it("counts from the start when no notice was ever sent", () => {
      expect(evaluateRule(withReminder, { value: 9, samples: 100 }, firing({ lastNotifiedAt: null }), at(61)).event).toBe("reminder");
    });

    it("never reminds if the rule has no reminder", () => {
      expect(evaluateRule(rule, { value: 9, samples: 100 }, firing(), at(100_000)).event).toBeNull();
    });

    it("does not remind during no_data, so a silent agent does not nag", () => {
      expect(evaluateRule(withReminder, { value: null, samples: 0 }, firing(), at(500)).event).toBeNull();
    });
  });
});

describe("formatAlertValue", () => {
  it("writes each metric in its own unit", () => {
    expect(formatAlertValue("error_rate", 12.54)).toBe("12.5 %");
    expect(formatAlertValue("satisfaction", 80)).toBe("80 %");
    expect(formatAlertValue("latency_p95", 1834.4)).toBe("1,834 ms");
    expect(formatAlertValue("cost", 3.2)).toBe("$3.20");
    expect(formatAlertValue("custom", 7)).toBe("7");
  });
});

describe("cost budgets", () => {
  const budget = { monthlyUsd: 100, warnPercent: 80 };
  const none = new Set<BudgetLevel>();
  const day = (d: number) => new Date(Date.UTC(2026, 9, d, 12)); // octubre 2026 (31 días)

  it("validates the amount, the percentage and the recipients", () => {
    expect(validateCostBudget({ monthlyUsd: 250, recipients: ["A@b.io"] })).toEqual({ monthlyUsd: 250, warnPercent: 80, recipients: ["a@b.io"], enabled: true });
    expect(fieldsOf(() => validateCostBudget({ monthlyUsd: 0 }))).toContain("monthlyUsd");
    expect(fieldsOf(() => validateCostBudget({ monthlyUsd: -5 }))).toContain("monthlyUsd");
    expect(fieldsOf(() => validateCostBudget({ monthlyUsd: 10, warnPercent: 100 }))).toContain("warnPercent");
    expect(fieldsOf(() => validateCostBudget({ monthlyUsd: 10, warnPercent: 0 }))).toContain("warnPercent");
    expect(fieldsOf(() => validateCostBudget({ monthlyUsd: 10, recipients: ["x"] }))).toContain("recipients");
  });

  it("identifies the month in UTC", () => {
    expect(monthKey(new Date("2026-10-31T23:59:59Z"))).toBe("2026-10-01");
    expect(monthKey(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11-01");
  });

  it("does not project the month end in the first days, nor with no spend", () => {
    expect(projectMonthEnd(10, new Date("2026-10-02T12:00:00Z"))).toBeNull();
    expect(projectMonthEnd(0, day(20))).toBeNull();
  });

  it("projects linearly: 31 days of October, 10.5 elapsed and $50 spent", () => {
    const projected = projectMonthEnd(50, new Date("2026-10-11T12:00:00Z"))!;
    expect(projected).toBeCloseTo((50 * 31) / 10.5, 5);
  });

  it("says nothing below the warning and with a calm forecast", () => {
    const result = evaluateBudget(budget, 20, day(20), none);
    expect(result.notify).toBeNull();
    expect(result.percent).toBe(20);
  });

  it("warns at the percentage, once", () => {
    expect(evaluateBudget(budget, 80, day(25), none)).toMatchObject({ notify: "warning", markNotified: ["warning", "forecast"] });
    expect(evaluateBudget(budget, 85, day(26), new Set<BudgetLevel>(["warning"])).notify).toBeNull();
  });

  it("says 'exceeded' at 100 % and marks the lower levels as done", () => {
    expect(evaluateBudget(budget, 100, day(28), new Set<BudgetLevel>(["warning"]))).toMatchObject({ notify: "exceeded", markNotified: ["exceeded", "warning", "forecast"] });
    expect(evaluateBudget(budget, 140, day(29), new Set<BudgetLevel>(["warning", "exceeded"])).notify).toBeNull();
  });

  it("a jump from 70 % to 120 % sends 'exceeded', never a stale 'warning' after it", () => {
    expect(evaluateBudget(budget, 120, day(15), none).notify).toBe("exceeded");
  });

  it("forecasts an overrun before reaching the warning, once", () => {
    const early = evaluateBudget(budget, 60, day(10), none); // 60 gastados en ~9,5 días: ~196 a fin de mes
    expect(early.notify).toBe("forecast");
    expect(early.projectedUsd).toBeGreaterThan(100);
    expect(evaluateBudget(budget, 60, day(11), new Set<BudgetLevel>(["forecast"])).notify).toBeNull();
  });

  it("a forecast does not fire in the first days of the month", () => {
    expect(evaluateBudget(budget, 60, day(2), none).notify).toBeNull();
  });

  it("a new month starts clean: the notified set is per month", () => {
    expect(evaluateBudget(budget, 90, new Date("2026-11-20T00:00:00Z"), none).notify).toBe("warning");
  });
});
