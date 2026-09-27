import { Resend } from "resend";
import type { EmailSender } from "@/application/ports/email-sender";

/** Se usa cuando no hay RESEND_API_KEY configurada (p.ej. entornos de dev): no debe romper el flujo de invitación. */
export class NoopEmailSender implements EmailSender {
  async sendInvitationEmail(params: { to: string }): Promise<void> {
    console.warn(`[email] RESEND_API_KEY no configurada: invitación a ${params.to} no enviada.`);
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
}
