import { ApiError } from "@/application/trace-api";
import { tr } from "@/domain/translate";

/** Mensaje según el error que devuelve la API; el `detail` (problem+json) distingue las casuísticas de 404 y 403. */
export function describeApiError(e: Error): string {
  if (!(e instanceof ApiError)) return e.message;
  const detail = e.detail ?? "";
  if (e.status === 0) return tr("apiError.unreachable");
  if (e.status === 401) return tr("apiError.sessionExpired");
  if (e.status === 403) return tr("apiError.forbidden");
  if (e.status === 503) return tr("apiError.storeDown");
  if (e.status === 404) {
    if (/experiment/i.test(detail)) return tr("apiError.experimentMissing");
    if (/trace|span/i.test(detail)) return tr("apiError.traceMissing");
    if (/conversation/i.test(detail)) return tr("apiError.conversationMissing");
    return detail || tr("apiError.notFound");
  }
  return detail || e.title;
}
