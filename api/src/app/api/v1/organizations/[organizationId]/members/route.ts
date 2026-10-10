import { auditOrganization } from "@/adapters/inbound/http/audit-context";
import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { addOrgAdminBody, parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Lista los miembros aceptados y las invitaciones pendientes de la organización. Requiere ser org_admin. */
export async function GET(_request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return identityGuard(async () => {
    const { organizationId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    const { identityRepository, authorizationService } = getIdentity();
    if (!(await authorizationService.canManageOrganization(user.id, organizationId))) {
      return problem(403, "Forbidden", "No permission to manage members of this organization");
    }

    const [members, pendingInvitations] = await Promise.all([
      identityRepository.listOrgMembers(organizationId),
      identityRepository.listPendingInvitations({ organizationId }),
    ]);
    return json({ members, pendingInvitations });
  });
}

/**
 * Invita a otro usuario como org_admin de esta organización (ADR-013/ADR-014). Requiere ser org_admin ya.
 * Si el invitado no tiene cuenta todavía, se guarda como invitación pendiente y se le manda un email:
 * se aplica sola en cuanto haga login por primera vez (ver events.createUser en auth.ts).
 */
export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return identityGuard(async () => {
    const { organizationId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    const { identityRepository, authorizationService, emailSender } = getIdentity();
    if (!(await authorizationService.canManageOrganization(user.id, organizationId))) {
      return problem(403, "Forbidden", "No permission to manage members of this organization");
    }

    const organization = await identityRepository.getOrganization(organizationId);
    if (!organization) return problem(404, "Not Found", "Organization not found");

    const { email } = await parseJsonOrThrow(addOrgAdminBody, request);
    const invitee = await identityRepository.getUserByEmail(email);
    if (!invitee) {
      await identityRepository.createPendingInvitation(email, { organizationId, role: "org_admin" }, user.id);
      await emailSender.sendInvitationEmail({
        to: email,
        invitedByName: user.name ?? user.email,
        targetName: organization.name,
        roleLabel: "org_admin",
        appUrl: new URL(request.url).origin,
      });
      await auditOrganization(user, organizationId, "member.add", { type: "user", id: email }, { role: "org_admin", status: "pending" });
      return json({ organizationId, email, role: "org_admin", status: "pending" }, 202);
    }

    await identityRepository.addOrgAdmin(organizationId, invitee.id);
    await auditOrganization(user, organizationId, "member.add", { type: "user", id: invitee.id }, { role: "org_admin", status: "added" });
    return json({ organizationId, userId: invitee.id, role: "org_admin" }, 201);
  });
}
