/** Puerto de salida: envío de emails (ADR-014). Hoy solo se usa para invitaciones. */
export interface EmailSender {
  sendInvitationEmail(params: { to: string; invitedByName: string; targetName: string; roleLabel: string; appUrl: string }): Promise<void>;
}
