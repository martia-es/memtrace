import type { AlertEventKind, AlertMetric, BudgetLevel, Comparator } from "@/domain/alert";

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
  /**
   * Aviso de una alerta (ADR-086). Un email por destinatario: nadie ve las direcciones de los demás. Sin contenido de trazas.
   * Devuelve a cuántas direcciones se envió de verdad (0 sin proveedor de correo): el evaluador lo guarda en el historial.
   */
  sendAlertEmail(params: AlertEmail): Promise<number>;
  /** Aviso de un presupuesto de coste (ADR-086), también un email por destinatario. */
  sendBudgetEmail(params: BudgetEmail): Promise<number>;
}

export interface AlertEmail {
  to: string[];
  kind: AlertEventKind;
  ruleName: string;
  experimentName: string;
  metric: AlertMetric;
  comparator: Comparator;
  windowMinutes: number;
  /** ya con su unidad: «12.5 %», «$3.20» */
  valueText: string;
  thresholdText: string;
  /** enlace a la pantalla de alertas del experimento */
  link: string;
}

export interface BudgetEmail {
  to: string[];
  level: BudgetLevel;
  experimentName: string;
  budgetUsd: number;
  spentUsd: number;
  percent: number;
  projectedUsd: number | null;
  link: string;
}
