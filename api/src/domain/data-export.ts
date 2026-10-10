import { ValidationError } from "./errors";

/** Exportación de datos de un experimento (ADR-084): un tipo de dato por petición, como JSON Lines. */
export const EXPORT_KINDS = ["traces", "annotations", "feedback", "scores"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const MAX_EXPORT_RANGE_DAYS = 31;
/** Por encima de esto se pide acotar el rango: una descarga no debe agotar el almacén ni el navegador. */
export const MAX_EXPORT_ROWS = 2_000_000;

const DAY_MS = 86_400_000;

export function isExportKind(value: string): value is ExportKind {
  return (EXPORT_KINDS as readonly string[]).includes(value);
}

export interface ExportRequest {
  kind: ExportKind;
  from: Date;
  to: Date;
}

/** Valida el tipo y un rango [from, to) de como mucho 31 días, ambos obligatorios (no hay «exportar todo»). */
export function parseExportRequest(input: { kind: unknown; from: unknown; to: unknown }): ExportRequest {
  const fields: Record<string, string> = {};
  const kind = typeof input.kind === "string" && isExportKind(input.kind) ? input.kind : null;
  if (!kind) fields.kind = `Must be one of: ${EXPORT_KINDS.join(", ")}`;
  const parse = (value: unknown, name: string): Date | null => {
    const d = typeof value === "string" && value ? new Date(value) : null;
    if (!d || Number.isNaN(d.getTime())) {
      fields[name] = "Required, as an ISO 8601 date";
      return null;
    }
    return d;
  };
  const from = parse(input.from, "from");
  const to = parse(input.to, "to");
  if (from && to) {
    if (to.getTime() <= from.getTime()) fields.to = "Must be after `from`";
    else if (to.getTime() - from.getTime() > MAX_EXPORT_RANGE_DAYS * DAY_MS) fields.to = `The range can be at most ${MAX_EXPORT_RANGE_DAYS} days`;
  }
  if (Object.keys(fields).length > 0 || !kind || !from || !to) throw new ValidationError("Invalid export request", fields);
  return { kind, from, to };
}

export function exportFilename(serviceName: string, request: ExportRequest): string {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const safe = serviceName.replace(/[^A-Za-z0-9._-]/g, "_");
  return `${safe}-${request.kind}-${day(request.from)}_${day(request.to)}.jsonl`;
}
