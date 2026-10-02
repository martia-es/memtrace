/** Una fila de un gráfico, ya calculada, para el resumen en texto del email (ADR-033). */
export interface ReportChartSnapshot {
  name: string;
  rows: Array<{ label: string; value: number }>;
}

/** Puerto de salida: envío de emails (ADR-014). */
export interface EmailSender {
  sendInvitationEmail(params: { to: string; invitedByName: string; targetName: string; roleLabel: string; appUrl: string }): Promise<void>;
  /** Instantánea de un informe (ADR-033): tabla de valores por gráfico, no una imagen renderizada. */
  sendReportSnapshotEmail(params: { to: string[]; reportName: string; experimentName: string; charts: ReportChartSnapshot[]; appUrl: string }): Promise<void>;
}
