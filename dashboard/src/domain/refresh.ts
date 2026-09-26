/** Intervalos de actualización automática (segundos); 0 = desactivada. */
export const REFRESH_OPTIONS = [0, 5, 10, 30] as const;
export type RefreshSeconds = (typeof REFRESH_OPTIONS)[number];
export const DEFAULT_REFRESH_SECONDS: RefreshSeconds = 5;

export function isRefreshSeconds(value: unknown): value is RefreshSeconds {
  return REFRESH_OPTIONS.includes(value as RefreshSeconds);
}
