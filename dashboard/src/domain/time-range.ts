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

/** Rango relativo a `nowMs`: al refrescar, la ventana avanza con el reloj. */
export function resolveRange(key: RangeKey, nowMs: number): { from: string; to: string } {
  const preset = RANGE_PRESETS.find((p) => p.key === key)!;
  return { from: new Date(nowMs - preset.ms).toISOString(), to: new Date(nowMs).toISOString() };
}
