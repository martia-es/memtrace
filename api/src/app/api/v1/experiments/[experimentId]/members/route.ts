import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { addMemberBody, parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Lista los miembros aceptados y las invitaciones pendientes del experimento. Requiere ser org_admin o admin. */
export async function GET(_request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    const { identityRepository, authorizationService } = getIdentity();
    if (!(await authorizationService.canManageExperimentMembers(user.id, experimentId))) {
      return problem(403, "Forbidden", "No permission to manage members of this experiment");
    }

    const [members, pendingInvitations] = await Promise.all([
      identityRepository.listExperimentMembers(experimentId),
      identityRepository.listPendingInvitations({ experimentId }),
    ]);
    return json({ members, pendingInvitations });
  });
}

/**
 * Invita a otro usuario a este experimento (ADR-013/ADR-014). Requiere ser org_admin o admin del experimento.
 * Si el invitado no tiene cuenta todavía, se guarda como invitación pendiente y se le manda un email:
 * se aplica sola en cuanto haga login por primera vez (ver events.createUser en auth.ts).
 */
export async function POST(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    const { identityRepository, authorizationService, emailSender } = getIdentity();
    if (!(await authorizationService.canManageExperimentMembers(user.id, experimentId))) {
      return problem(403, "Forbidden", "No permission to manage members of this experiment");
    }

    const experiment = await identityRepository.getExperiment(experimentId);
    if (!experiment) return problem(404, "Not Found", "Experiment not found");

    const { email, role } = await parseJsonOrThrow(addMemberBody, request);
    const invitee = await identityRepository.getUserByEmail(email);
    if (!invitee) {
      await identityRepository.createPendingInvitation(email, { experimentId, role }, user.id);
      await emailSender.sendInvitationEmail({
        to: email,
        invitedByName: user.name ?? user.email,
        targetName: experiment.name,
        roleLabel: role,
        appUrl: new URL(request.url).origin,
      });
      return json({ experimentId, email, role, status: "pending" }, 202);
    }

    await identityRepository.addExperimentMember(experimentId, invitee.id, role);
    return json({ experimentId, userId: invitee.id, role }, 201);
  });
}
