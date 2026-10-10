import { Resend } from "resend";
import type { AlertEmail, BudgetEmail, EmailSender, ReportChartSnapshot } from "@/application/ports/email-sender";
import { alertEmailContent, budgetEmailContent } from "./alert-emails";

function reportSnapshotHtml(reportName: string, experimentName: string, charts: ReportChartSnapshot[], appUrl: string): string {
  const tables = charts
    .map(
      (c) => `<h3 style="margin:20px 0 8px;font-size:15px;">${c.name}</h3>
<table style="width:100%;border-collapse:collapse;font-size:13px;">
  <tbody>
    ${c.rows.map((r) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;">${r.label}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">${r.value.toLocaleString()}</td></tr>`).join("\n")}
  </tbody>
</table>`,
    )
    .join("\n");

  return `<p>Instantánea del informe <strong>${reportName}</strong> de <strong>${experimentName}</strong> en MemTrace.</p>
${tables}
<p style="margin-top:20px;"><a href="${appUrl}">Ver el informe en vivo en MemTrace</a></p>`;
}

/** Se usa cuando no hay RESEND_API_KEY configurada (p.ej. entornos de dev): no debe romper el flujo de invitación. */
export class NoopEmailSender implements EmailSender {
  async sendInvitationEmail(params: { to: string }): Promise<void> {
    console.warn(`[email] RESEND_API_KEY no configurada: invitación a ${params.to} no enviada.`);
  }

  async sendReportSnapshotEmail(params: { to: string[] }): Promise<void> {
    console.warn(`[email] RESEND_API_KEY no configurada: informe no enviado a ${params.to.join(", ")}.`);
  }

  async sendAlertEmail(params: AlertEmail): Promise<number> {
    console.warn(`[email] RESEND_API_KEY no configurada: alerta "${params.ruleName}" no enviada a ${params.to.length} dirección(es).`);
    return 0;
  }

  async sendBudgetEmail(params: BudgetEmail): Promise<number> {
    console.warn(`[email] RESEND_API_KEY no configurada: aviso de presupuesto de ${params.experimentName} no enviado a ${params.to.length} dirección(es).`);
    return 0;
  }
}

export class ResendEmailSender implements EmailSender {
  private readonly resend: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.resend = new Resend(apiKey);
  }

  async sendInvitationEmail(params: { to: string; invitedByName: string; targetName: string; roleLabel: string; appUrl: string }): Promise<void> {
    await this.resend.emails.send({
      from: this.from,
      to: params.to,
      subject: `${params.invitedByName} te ha invitado a ${params.targetName} en MemTrace`,
      html: `<p>${params.invitedByName} te ha invitado como <strong>${params.roleLabel}</strong> a <strong>${params.targetName}</strong> en MemTrace.</p>
<p>Inicia sesión con tu cuenta de Google o Microsoft en <a href="${params.appUrl}">${params.appUrl}</a> para tener acceso automáticamente.</p>`,
    });
  }

  async sendReportSnapshotEmail(params: { to: string[]; reportName: string; experimentName: string; charts: ReportChartSnapshot[]; appUrl: string }): Promise<void> {
    await this.resend.emails.send({
      from: this.from,
      to: params.to,
      subject: `Informe "${params.reportName}" — ${params.experimentName} (MemTrace)`,
      html: reportSnapshotHtml(params.reportName, params.experimentName, params.charts, params.appUrl),
    });
  }

  async sendAlertEmail(params: AlertEmail): Promise<number> {
    const { subject, html, text } = alertEmailContent(params);
    return this.sendEach(params.to, subject, html, text);
  }

  async sendBudgetEmail(params: BudgetEmail): Promise<number> {
    const { subject, html, text } = budgetEmailContent(params);
    return this.sendEach(params.to, subject, html, text);
  }

  /** Un email por destinatario (nadie ve a los demás); un fallo no impide el resto. Devuelve cuántos salieron. */
  private async sendEach(recipients: string[], subject: string, html: string, text: string): Promise<number> {
    const results = await Promise.allSettled(recipients.map((to) => this.resend.emails.send({ from: this.from, to, subject, html, text })));
    let sent = 0;
    for (const r of results) {
      if (r.status === "fulfilled" && !r.value.error) sent += 1;
      else console.error("[email] could not send an alert email:", r.status === "rejected" ? r.reason : r.value.error);
    }
    return sent;
  }
}
