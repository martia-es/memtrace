import { describe, expect, it } from "vitest";
import type { MonthCostDto } from "@contract";
import { costTrendOf } from "@/domain/cost-trend";

const DAILY = [2.1, 2.6, 2.9, 3.0, 2.8, 2.2, 2.4, 3.4, 3.6, 3.9, 4.2, 5.62];
const SPENT = DAILY.reduce((a, b) => a + b, 0);
const BUDGET = { monthlyUsd: 95 };
const view = (over: Partial<MonthCostDto> = {}): MonthCostDto => ({
  month: "2026-10-01",
  spentUsd: SPENT,
  projectedUsd: (SPENT * 31) / 11.5,
  daily: DAILY.map((costUsd, i) => ({ day: `2026-10-${String(i + 1).padStart(2, "0")}`, costUsd })),
  ...over,
});
const NOW = new Date("2026-10-12T12:00:00Z");

describe("costTrendOf", () => {
  it("builds the cumulative spend ending today and a projection to the end of the month", () => {
    const t = costTrendOf(view(), BUDGET, NOW);
    expect(t).toMatchObject({ state: "forecast", daysInMonth: 31, elapsedDays: 11.5, monthLabel: "Oct" });
    expect(t.spent[0]).toEqual({ x: 0, y: 0 });
    expect(t.spent.at(-1)).toEqual({ x: 11.5, y: expect.closeTo(SPENT, 6) });
    expect(t.spent).toHaveLength(13);
    expect(t.projection).toEqual([{ x: 11.5, y: expect.closeTo(SPENT, 6) }, { x: 31, y: expect.closeTo((SPENT * 31) / 11.5, 6) }]);
    expect(t.overUsd).toBeGreaterThan(0);
  });

  it("says the day the current pace crosses the budget", () => {
    const t = costTrendOf(view(), BUDGET, NOW);
    // ritmo = gastado / días transcurridos; el cruce cae unos 17 días después de hoy
    const crossX = 11.5 + (95 - SPENT) / (SPENT / 11.5);
    expect(t.crossDay).toBe(Math.ceil(crossX));
    expect(t.crossLabel).toBe(`Oct ${Math.ceil(crossX)}`);
  });

  it("is on track when the forecast stays under the budget, with no crossing", () => {
    const t = costTrendOf(view({ projectedUsd: 80 }), BUDGET, NOW);
    expect(t).toMatchObject({ state: "on_track", overUsd: 0, crossDay: null, crossLabel: null });
    expect(t.projection).toHaveLength(2);
  });

  it("drops the projection once the budget is exceeded", () => {
    const t = costTrendOf(view({ spentUsd: 99 }), BUDGET, NOW);
    expect(t).toMatchObject({ state: "exceeded", projection: [], crossDay: null });
  });

  it("does not project before there is enough data", () => {
    const t = costTrendOf(view({ projectedUsd: null, daily: [{ day: "2026-10-01", costUsd: 3 }], spentUsd: 3 }), BUDGET, new Date("2026-10-02T06:00:00Z"));
    expect(t).toMatchObject({ state: "early", projection: [], projectedUsd: null });
    expect(t.spent).toEqual([{ x: 0, y: 0 }, { x: 1, y: 3 }, { x: 1.25, y: 3 }]);
  });

  it("carries the total over days without data and handles a 30-day month", () => {
    const t = costTrendOf(view({ month: "2026-09-01", daily: [{ day: "2026-09-01", costUsd: 4 }, { day: "2026-09-04", costUsd: 6 }], spentUsd: 10 }), BUDGET, new Date("2026-09-04T12:00:00Z"));
    expect(t.daysInMonth).toBe(30);
    expect(t.spent.map((p) => p.y)).toEqual([0, 4, 4, 4, 10]);
    expect(t.bars).toEqual([{ day: 1, costUsd: 4 }, { day: 4, costUsd: 6 }]);
  });

  it("draws the spend and the forecast without a budget, with no line and no crossing", () => {
    const t = costTrendOf(view(), null, NOW);
    expect(t).toMatchObject({ state: "no_budget", monthlyUsd: null, overUsd: 0, crossDay: null, crossLabel: null });
    expect(t.projection).toHaveLength(2);
    expect(t.spent.at(-1)).toEqual({ x: 11.5, y: expect.closeTo(SPENT, 6) });
  });

  it("is too early without a budget too", () => {
    expect(costTrendOf(view({ projectedUsd: null }), null, NOW)).toMatchObject({ state: "early", projection: [] });
  });
});
