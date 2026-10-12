import { describe, expect, it } from "vitest";
import type { BudgetViewDto } from "@contract";
import { costTrendOf } from "@/domain/cost-trend";

const DAILY = [2.1, 2.6, 2.9, 3.0, 2.8, 2.2, 2.4, 3.4, 3.6, 3.9, 4.2, 5.62];
const SPENT = DAILY.reduce((a, b) => a + b, 0);
const view = (over: Partial<BudgetViewDto> = {}): BudgetViewDto => ({
  budget: { experimentId: "exp-1", monthlyUsd: 95, warnPercent: 80, recipients: [], enabled: true, updatedAt: "" },
  month: "2026-10-01",
  spentUsd: SPENT,
  percent: (SPENT / 95) * 100,
  projectedUsd: (SPENT * 31) / 11.5,
  daily: DAILY.map((costUsd, i) => ({ day: `2026-10-${String(i + 1).padStart(2, "0")}`, costUsd })),
  ...over,
});
const NOW = new Date("2026-10-12T12:00:00Z");

describe("costTrendOf", () => {
  it("builds the cumulative spend ending today and a projection to the end of the month", () => {
    const t = costTrendOf(view(), NOW);
    expect(t).toMatchObject({ state: "forecast", daysInMonth: 31, elapsedDays: 11.5, monthLabel: "Oct" });
    expect(t.spent[0]).toEqual({ x: 0, y: 0 });
    expect(t.spent.at(-1)).toEqual({ x: 11.5, y: expect.closeTo(SPENT, 6) });
    expect(t.spent).toHaveLength(13);
    expect(t.projection).toEqual([{ x: 11.5, y: expect.closeTo(SPENT, 6) }, { x: 31, y: expect.closeTo((SPENT * 31) / 11.5, 6) }]);
    expect(t.overUsd).toBeGreaterThan(0);
  });

  it("says the day the current pace crosses the budget", () => {
    const t = costTrendOf(view(), NOW);
    // ritmo = gastado / días transcurridos; el cruce cae unos 17 días después de hoy
    const crossX = 11.5 + (95 - SPENT) / (SPENT / 11.5);
    expect(t.crossDay).toBe(Math.ceil(crossX));
    expect(t.crossLabel).toBe(`Oct ${Math.ceil(crossX)}`);
  });

  it("is on track when the forecast stays under the budget, with no crossing", () => {
    const t = costTrendOf(view({ projectedUsd: 80 }), NOW);
    expect(t).toMatchObject({ state: "on_track", overUsd: 0, crossDay: null, crossLabel: null });
    expect(t.projection).toHaveLength(2);
  });

  it("drops the projection once the budget is exceeded", () => {
    const t = costTrendOf(view({ percent: 104, spentUsd: 99 }), NOW);
    expect(t).toMatchObject({ state: "exceeded", projection: [], crossDay: null });
  });

  it("does not project before there is enough data", () => {
    const t = costTrendOf(view({ projectedUsd: null, daily: [{ day: "2026-10-01", costUsd: 3 }], spentUsd: 3, percent: 3 }), new Date("2026-10-02T06:00:00Z"));
    expect(t).toMatchObject({ state: "early", projection: [], projectedUsd: null });
    expect(t.spent).toEqual([{ x: 0, y: 0 }, { x: 1, y: 3 }, { x: 1.25, y: 3 }]);
  });

  it("carries the total over days without data and handles a 30-day month", () => {
    const t = costTrendOf(view({ month: "2026-09-01", daily: [{ day: "2026-09-01", costUsd: 4 }, { day: "2026-09-04", costUsd: 6 }], spentUsd: 10 }), new Date("2026-09-04T12:00:00Z"));
    expect(t.daysInMonth).toBe(30);
    expect(t.spent.map((p) => p.y)).toEqual([0, 4, 4, 4, 10]);
    expect(t.bars).toEqual([{ day: 1, costUsd: 4 }, { day: 4, costUsd: 6 }]);
  });
});
