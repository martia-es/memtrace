import { PartnershipInvariantError, PartnershipNotFoundError, ValidationError } from "@/domain/errors";
import type { NewPartnerGrant, PartnerClient, PartnerGrant, Partnership } from "@/domain/partnership";
import type { PartnershipRepository } from "./ports/partnership-repository";

/**
 * Casos de uso de la relación partner (ADR-080). Quién puede llamarlos (org_admin del CLIENTE) lo decide la route; aquí
 * van las reglas que no dependen de quién llama: el alcance de un grant, el rol y que la persona sea de la consultora.
 */
export class PartnershipService {
  constructor(private readonly repository: PartnershipRepository) {}

  list(clientOrganizationId: string): Promise<Partnership[]> {
    return this.repository.listForClient(clientOrganizationId);
  }

  async create(clientOrganizationId: string, partnerOrganizationId: string, actorUserId: string): Promise<Partnership> {
    if (clientOrganizationId === partnerOrganizationId) throw new PartnershipInvariantError("An organization cannot be its own partner");
    if (!(await this.repository.organizationName(partnerOrganizationId))) throw new PartnershipNotFoundError("Partner organization");
    const created = await this.repository.create(clientOrganizationId, partnerOrganizationId, actorUserId);
    if (!created) throw new PartnershipInvariantError("That organization is already a partner");
    return (await this.repository.getActive(clientOrganizationId, created.id))!;
  }

  async revoke(clientOrganizationId: string, partnershipId: string, actorUserId: string): Promise<void> {
    if (!(await this.repository.revoke(clientOrganizationId, partnershipId, actorUserId))) throw new PartnershipNotFoundError();
  }

  async grant(clientOrganizationId: string, partnershipId: string, input: NewPartnerGrant, actorUserId: string): Promise<PartnerGrant> {
    const partnership = await this.repository.getActive(clientOrganizationId, partnershipId);
    if (!partnership) throw new PartnershipNotFoundError();

    if (!(await this.repository.experimentRoleNames()).includes(input.role)) {
      throw new ValidationError("Invalid role", { role: "must be an experiment role (for example technical or business)" });
    }
    if (input.experimentId && !(await this.repository.experimentBelongsTo(input.experimentId, clientOrganizationId))) {
      throw new ValidationError("Unknown experiment", { experimentId: "must be an experiment of this organization" });
    }
    const person = await this.repository.findPartnerMember(partnership.partnerOrganizationId, input.email);
    if (!person) throw new PartnershipInvariantError("That person is not a member of the partner organization");
    return this.repository.grant(partnershipId, person.id, { role: input.role, experimentId: input.experimentId }, actorUserId);
  }

  async revokeGrant(clientOrganizationId: string, partnershipId: string, grantId: string, actorUserId: string): Promise<void> {
    if (!(await this.repository.getActive(clientOrganizationId, partnershipId))) throw new PartnershipNotFoundError();
    if (!(await this.repository.revokeGrant(partnershipId, grantId, actorUserId))) throw new PartnershipNotFoundError("Grant");
  }

  /** Para la persona de la consultora: los clientes que le han dado acceso. Nunca datos de trazas. */
  clientsOf(userId: string): Promise<PartnerClient[]> {
    return this.repository.listClientsForUser(userId);
  }
}
