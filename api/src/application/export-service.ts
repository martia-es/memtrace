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
 * Exportación de datos de un experimento (ADR-080). Quien llama ya comprobó `data:export`. Una exportación que no se puede
 * registrar en la auditoría no se hace: el registro se escribe ANTES de leer ningún dato.
 */
export class ExportService {
  constructor(
    private readonly exporter: DataExporter,
    private readonly audit: AuditService,
  ) {}

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
    const rows = await this.exporter.count(input.serviceName, request.kind, request.from, request.to);
    if (rows > MAX_EXPORT_ROWS) throw new ExportTooLargeError(rows, MAX_EXPORT_ROWS);

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
