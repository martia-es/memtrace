export const RANGE_PRESETS = [
  { key: "15m", label: "15 min", long: "Last 15 minutes", ms: 15 * 60_000 },
  { key: "1h", label: "1 h", long: "Last hour", ms: 60 * 60_000 },
  { key: "6h", label: "6 h", long: "Last 6 hours", ms: 6 * 60 * 60_000 },
  { key: "24h", label: "24 h", long: "Last 24 hours", ms: 24 * 60 * 60_000 },
  { key: "7d", label: "7 d", long: "Last 7 days", ms: 7 * 24 * 60 * 60_000 },
  { key: "30d", label: "30 d", long: "Last 30 days", ms: 30 * 24 * 60 * 60_000 }, // = ClickHouse retention (ADR-003)
] as const;

export type RangeKey = (typeof RANGE_PRESETS)[number]["key"];
export const DEFAULT_RANGE: RangeKey = "1h";

export function isRangeKey(value: unknown): value is RangeKey {
  return RANGE_PRESETS.some((preset) => preset.key === value);
}

/** Selección del usuario: un preset relativo o un rango propio ("custom", fechas YYYY-MM-DD en hora local). */
export type RangeSelection = RangeKey | "custom";
export type CustomRange = { from: string; to: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export function isCustomRange(from: unknown, to: unknown): boolean {
  return typeof from === "string" && typeof to === "string" && DAY.test(from) && DAY.test(to) && from <= to;
}

/** Rango relativo a `nowMs`: al refrescar, la ventana avanza con el reloj. Un rango propio es fijo (días completos). */
export function resolveRange(key: RangeSelection, nowMs: number, custom?: CustomRange): { from: string; to: string } {
  if (key === "custom" && custom) {
    return { from: new Date(`${custom.from}T00:00:00`).toISOString(), to: new Date(`${custom.to}T23:59:59.999`).toISOString() };
  }
  if (key === "custom") key = DEFAULT_RANGE;
  const preset = RANGE_PRESETS.find((p) => p.key === key)!;
  return { from: new Date(nowMs - preset.ms).toISOString(), to: new Date(nowMs).toISOString() };
}
