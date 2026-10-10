import type { NewPartnerGrant, PartnerClient, PartnerGrant, Partnership } from "@/domain/partnership";

/** Almacén de relaciones partner y grants (PostgreSQL, ADR-091). Nada se borra al revocar: se marca `revoked_at`. */
export interface PartnershipRepository {
  organizationName(organizationId: string): Promise<string | null>;
  /** relaciones activas de un cliente, con sus grants activos */
  listForClient(clientOrganizationId: string): Promise<Partnership[]>;
  getActive(clientOrganizationId: string, partnershipId: string): Promise<Partnership | null>;
  /** null si ya hay una relación activa con ese partner */
  create(clientOrganizationId: string, partnerOrganizationId: string, createdBy: string): Promise<{ id: string } | null>;
  /** revoca la relación y todos sus grants; false si no existía o ya estaba revocada */
  revoke(clientOrganizationId: string, partnershipId: string, revokedBy: string): Promise<boolean>;

  /** la persona (por email) solo se resuelve si es miembro de la organización partner */
  findPartnerMember(partnerOrganizationId: string, email: string): Promise<{ id: string } | null>;
  experimentBelongsTo(experimentId: string, organizationId: string): Promise<boolean>;
  experimentRoleNames(): Promise<string[]>;
  /** crea o actualiza el rol del grant activo (persona + alcance) */
  grant(partnershipId: string, userId: string, input: Pick<NewPartnerGrant, "role" | "experimentId">, grantedBy: string): Promise<PartnerGrant>;
  revokeGrant(partnershipId: string, grantId: string, revokedBy: string): Promise<boolean>;

  /** clientes que han dado acceso a esta persona, solo mientras siga siendo de la organización partner */
  listClientsForUser(userId: string): Promise<PartnerClient[]>;
}
