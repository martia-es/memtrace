import { ApiError } from "@/application/trace-api";

/** Mensaje según el error que devuelve la API; el `detail` (problem+json) distingue las casuísticas de 404 y 403. */
export function describeApiError(e: Error): string {
  if (!(e instanceof ApiError)) return e.message;
  const detail = e.detail ?? "";
  if (e.status === 0) return "Could not reach the API. Is it running (`npm run dev` in api/) and does the proxy point to it?";
  if (e.status === 401) return "Your session has expired. Sign in again to continue.";
  if (e.status === 403) return "You don't have access to this experiment. Ask an admin of the experiment or organization to add you.";
  if (e.status === 503) return "The trace store (ClickHouse) is not responding. Check `make status`.";
  if (e.status === 404) {
    if (/experiment/i.test(detail)) {
      return "This experiment doesn't exist or no experiment is selected. You don't have any yet? Create one in Administration.";
    }
    if (/trace|span/i.test(detail)) {
      return "This trace could not be found. It may be outside the retention period (30 days).";
    }
    if (/conversation/i.test(detail)) return "This conversation could not be found. It may be outside the retention period (30 days).";
    return detail || "Not found. If it's a trace, it may be outside the retention period (30 days).";
  }
  return detail || e.title;
}
