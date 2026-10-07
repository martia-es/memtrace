// Toda la interfaz está en inglés (ADR-048): números y fechas siguen el mismo idioma.
const number = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const dateTimeThisYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const dateTimeOtherYear = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "–";
  if (ms === 0) return "0 ms";
  const micros = Math.round(ms * 1000);
  if (micros < 1000) return `${micros} µs`;
  if (ms < 1000) return `${ms < 10 ? ms.toFixed(1) : ms.toFixed(0)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(2) : seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds % 60)} s`;
}

export function formatCount(value: number): string {
  return value >= 10_000 ? compact.format(value) : number.format(value);
}

export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(ratio > 0 && ratio < 0.1 ? 1 : 0)}%`;
}

export function formatRelativeTime(iso: string, nowMs: number): string {
  const seconds = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

const clock = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const clockShort = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

/** Hora del día (HH:MM:SS, o HH:MM con `seconds: false`) en la zona del navegador. */
export function formatClock(iso: string, seconds = true): string {
  return (seconds ? clock : clockShort).format(new Date(iso));
}

/** "Sep 26, 13:24:00"; con el año solo si no es el actual. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return (date.getFullYear() === new Date().getFullYear() ? dateTimeThisYear : dateTimeOtherYear).format(date);
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** SHA corto de un commit (7 caracteres, como en git); "–" si la traza no lleva versión (ADR-065). */
export function shortRevision(revision: string | null | undefined): string {
  return revision ? revision.slice(0, 7) : "–";
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
/** Precios de un único span suelen ser fracciones de centavo: más decimales para no redondear a $0.00. */
const usdPrecise = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 6 });

/** null si no hay coste conocido (span sin tokens, o sin precio para su modelo; ver ADR-025). */
export function formatCostUsd(value: number | null): string | null {
  if (value === null) return null;
  if (value === 0) return "$0.00";
  return value < 0.01 ? usdPrecise.format(value) : usd.format(value);
}

/** Precio por token expresado por millón de tokens: la convención habitual al listar precios de modelos. */
export function formatPricePerMillion(pricePerToken: number): string {
  return usd.format(pricePerToken * 1_000_000);
}
