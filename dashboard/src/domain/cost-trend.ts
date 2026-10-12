import type { BudgetViewDto } from "@contract";

const DAY_MS = 86_400_000;

/** `early`: aún no hay tres días de gasto, así que no se proyecta (la misma regla que el aviso de previsión, ADR-086). */
export type CostTrendState = "on_track" | "forecast" | "exceeded" | "early";

export interface CostTrend {
  state: CostTrendState;
  monthLabel: string;
  daysInMonth: number;
  /** días transcurridos del mes, con decimales: es donde acaba la línea de gasto */
  elapsedDays: number;
  spentUsd: number;
  monthlyUsd: number;
  projectedUsd: number | null;
  /** lo que la previsión pasa del presupuesto; 0 si no pasa */
  overUsd: number;
  /** día del mes (1-31) en que el ritmo actual cruza el presupuesto; solo con previsión por encima */
  crossDay: number | null;
  crossLabel: string | null;
  /** gasto de cada día con dato; `day` es el día del mes */
  bars: Array<{ day: number; costUsd: number }>;
  /** gasto acumulado: x en días desde el inicio del mes (0 al principio del día 1) */
  spent: Array<{ x: number; y: number }>;
  /** de hoy al fin de mes; vacío si no se proyecta */
  projection: Array<{ x: number; y: number }>;
}

/** Lo que pinta «Spend this month» (ADR-086): todo sale del presupuesto y su coste diario, sin otra consulta. */
export function costTrendOf(view: BudgetViewDto, now: Date): CostTrend {
  const start = new Date(`${view.month.slice(0, 10)}T00:00:00Z`);
  const daysInMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  const elapsedDays = Math.min(daysInMonth, Math.max(0, (now.getTime() - start.getTime()) / DAY_MS));
  const { monthlyUsd, spentUsd, projectedUsd } = { monthlyUsd: view.budget.monthlyUsd, spentUsd: view.spentUsd, projectedUsd: view.projectedUsd };

  const byDay = new Map(view.daily.map((d) => [Number(d.day.slice(8, 10)), d.costUsd]));
  const bars = [...byDay].map(([day, costUsd]) => ({ day, costUsd })).sort((a, b) => a.day - b.day);
  const spent = [{ x: 0, y: 0 }];
  let acc = 0;
  for (let day = 1; day <= Math.min(daysInMonth, Math.ceil(elapsedDays)); day++) {
    acc += byDay.get(day) ?? 0;
    spent.push({ x: Math.min(day, elapsedDays), y: acc });
  }

  const state: CostTrendState = view.percent >= 100 ? "exceeded" : projectedUsd === null ? "early" : projectedUsd >= monthlyUsd ? "forecast" : "on_track";
  const projection = state === "forecast" || state === "on_track" ? [{ x: elapsedDays, y: spentUsd }, { x: daysInMonth, y: projectedUsd! }] : [];

  let crossDay: number | null = null;
  if (state === "forecast" && spentUsd > 0 && elapsedDays > 0) {
    const crossX = elapsedDays + (monthlyUsd - spentUsd) / (spentUsd / elapsedDays);
    crossDay = Math.min(daysInMonth, Math.max(1, Math.ceil(crossX)));
  }
  const monthName = start.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return {
    state, monthLabel: monthName, daysInMonth, elapsedDays, spentUsd, monthlyUsd, projectedUsd,
    overUsd: projectedUsd !== null ? Math.max(0, projectedUsd - monthlyUsd) : 0,
    crossDay, crossLabel: crossDay === null ? null : `${monthName} ${crossDay}`,
    bars, spent, projection,
  };
}
