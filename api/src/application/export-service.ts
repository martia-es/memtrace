import type { AuditService } from "@/application/audit-service";
import type { DataExporter } from "@/application/ports/data-exporter";
import { MAX_EXPORT_ROWS, exportFilename, parseExportRequest } from "@/domain/data-export";
import { ExportTooLargeError } from "@/domain/errors";

export interface StartedExport {
  filename: string;
  rows: number;
  lines: AsyncIterable<string>;
}

/**
 * Exportación de datos de un experimento (ADR-084). Quien llama ya comprobó `data:export`. Una exportación que no se puede
 * registrar en la auditoría no se hace: el registro se escribe ANTES de leer ningún dato.
 */
export class ExportService {
  constructor(
    private readonly exporter: DataExporter,
    private readonly audit: AuditService,
  ) {}

  /**
   * Valida la petición y dice cuántas filas tendría, sin leer ni registrar nada: lo usa la pantalla antes de ofrecer la descarga
   * para poder explicar un error (rango, tamaño) sin que el navegador acabe en una página de error.
   */
  async preview(input: { serviceName: string; kind: unknown; from: unknown; to: unknown }): Promise<{ rows: number; maxRows: number }> {
    const request = parseExportRequest(input);
    const rows = await this.exporter.count(input.serviceName, request.kind, request.from, request.to);
    if (rows > MAX_EXPORT_ROWS) throw new ExportTooLargeError(rows, MAX_EXPORT_ROWS);
    return { rows, maxRows: MAX_EXPORT_ROWS };
  }

  async start(input: {
    organizationId: string;
    experimentId: string;
    serviceName: string;
    actor: { userId: string; email: string };
    kind: unknown;
    from: unknown;
    to: unknown;
  }): Promise<StartedExport> {
    const request = parseExportRequest(input);
    const { rows } = await this.preview(input);

    await this.audit.record({
      organizationId: input.organizationId,
      experimentId: input.experimentId,
      actorUserId: input.actor.userId,
      actorLabel: input.actor.email,
      action: "data.export",
      targetType: "export",
      targetId: request.kind,
      metadata: { kind: request.kind, from: request.from.toISOString(), to: request.to.toISOString(), rows },
    });
    return { filename: exportFilename(input.serviceName, request), rows, lines: this.exporter.stream(input.serviceName, request.kind, request.from, request.to) };
  }
}
