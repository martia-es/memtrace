import { PartnershipInvariantError, PartnershipNotFoundError, ValidationError } from "@/domain/errors";
import type { NewPartnerGrant, PartnerClient, PartnerGrant, Partnership } from "@/domain/partnership";
import type { AuditService } from "./audit-service";
import type { PartnershipRepository } from "./ports/partnership-repository";

type Actor = { id: string; email: string | null };
const who = (actor: Actor) => ({ actorUserId: actor.id, actorLabel: actor.email ?? actor.id });

/**
 * Casos de uso de la relación partner (ADR-091). Quién puede llamarlos (org_admin del CLIENTE) lo decide la route; aquí
 * van las reglas que no dependen de quién llama: el alcance de un grant, el rol y que la persona sea de la consultora.
 */
export class PartnershipService {
  constructor(
    private readonly repository: PartnershipRepository,
    private readonly audit: Pick<AuditService, "record">,
  ) {}

  list(clientOrganizationId: string): Promise<Partnership[]> {
    return this.repository.listForClient(clientOrganizationId);
  }

  async create(clientOrganizationId: string, partnerOrganizationId: string, actor: Actor): Promise<Partnership> {
    if (clientOrganizationId === partnerOrganizationId) throw new PartnershipInvariantError("An organization cannot be its own partner");
    const partnerName = await this.repository.organizationName(partnerOrganizationId);
    if (!partnerName) throw new PartnershipNotFoundError("Partner organization");
    const created = await this.repository.create(clientOrganizationId, partnerOrganizationId, actor.id);
    if (!created) throw new PartnershipInvariantError("That organization is already a partner");
    await this.audit.record({ action: "partnership.create", ...who(actor), organizationId: clientOrganizationId, experimentId: null, targetType: "partnership", targetId: created.id, metadata: { partnerOrganizationId, partnerOrganizationName: partnerName } });
    return (await this.repository.getActive(clientOrganizationId, created.id))!;
  }

  async revoke(clientOrganizationId: string, partnershipId: string, actor: Actor): Promise<void> {
    const partnership = await this.repository.getActive(clientOrganizationId, partnershipId);
    if (!partnership || !(await this.repository.revoke(clientOrganizationId, partnershipId, actor.id))) throw new PartnershipNotFoundError();
    await this.audit.record({
      action: "partnership.revoke", ...who(actor), organizationId: clientOrganizationId, experimentId: null, targetType: "partnership", targetId: partnershipId,
      metadata: { partnerOrganizationId: partnership.partnerOrganizationId, grantsRevoked: partnership.grants.length },
    });
  }

  async grant(clientOrganizationId: string, partnershipId: string, input: NewPartnerGrant, actor: Actor): Promise<PartnerGrant> {
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
    const grant = await this.repository.grant(partnershipId, person.id, { role: input.role, experimentId: input.experimentId }, actor.id);
    await this.audit.record({
      action: "partner_grant.create", ...who(actor), organizationId: clientOrganizationId, experimentId: input.experimentId, targetType: "partner_grant", targetId: grant.id,
      metadata: { email: grant.userEmail, role: grant.role, scope: input.experimentId ? "experiment" : "organization", partnershipId },
    });
    return grant;
  }

  async revokeGrant(clientOrganizationId: string, partnershipId: string, grantId: string, actor: Actor): Promise<void> {
    const partnership = await this.repository.getActive(clientOrganizationId, partnershipId);
    if (!partnership) throw new PartnershipNotFoundError();
    const grant = partnership.grants.find((g) => g.id === grantId);
    if (!(await this.repository.revokeGrant(partnershipId, grantId, actor.id))) throw new PartnershipNotFoundError("Grant");
    await this.audit.record({
      action: "partner_grant.revoke", ...who(actor), organizationId: clientOrganizationId, experimentId: grant?.experimentId ?? null, targetType: "partner_grant", targetId: grantId,
      metadata: { email: grant?.userEmail ?? null, role: grant?.role ?? null, partnershipId },
    });
  }

  /** Para la persona de la consultora: los clientes que le han dado acceso. Nunca datos de trazas. */
  clientsOf(userId: string): Promise<PartnerClient[]> {
    return this.repository.listClientsForUser(userId);
  }
}
