import { noContent, scimBody, scimGuard, scimJson, scimProblem } from "@/adapters/inbound/http/scim-http";
import { getExternalAccess } from "@/dependency-container";
import { groupMemberPatch, groupResource, memberIds, type ScimPatchOp } from "@/domain/scim";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  return scimGuard(request, async ({ organizationId, baseUrl }) => {
    const group = await getExternalAccess().externalRepository.getScimGroup(organizationId, (await context.params).id);
    return group ? scimJson(groupResource(baseUrl, group)) : scimProblem(404, "Group not found");
  });
}

/** Quien entra o sale del grupo gana o pierde sus roles al momento, y también cuando cambia el nombre del grupo. */
async function change(request: Request, context: Params, patch: (body: Record<string, unknown>) => Parameters<ReturnType<typeof getExternalAccess>["externalRepository"]["updateScimGroup"]>[2]) {
  return scimGuard(request, async ({ organizationId, baseUrl }) => {
    const { id } = await context.params;
    const { externalRepository, externalAccessService } = getExternalAccess();
    const before = await externalRepository.getScimGroup(organizationId, id);
    if (!before) return scimProblem(404, "Group not found");
    const after = await externalRepository.updateScimGroup(organizationId, id, patch(await scimBody(request)));
    if (!after) return scimProblem(409, "A group with that displayName already exists", "uniqueness");
    await externalAccessService.resyncScim(organizationId, [...new Set([...before.memberIds, ...after.memberIds])]);
    return scimJson(groupResource(baseUrl, after));
  });
}

export async function PUT(request: Request, context: Params) {
  return change(request, context, (body) => ({
    ...(typeof body.displayName === "string" && body.displayName.trim() ? { displayName: body.displayName.trim() } : {}),
    externalId: typeof body.externalId === "string" ? body.externalId : null,
    replace: memberIds(body.members),
  }));
}

export async function PATCH(request: Request, context: Params) {
  return change(request, context, (body) => {
    const ops = Array.isArray(body.Operations) ? (body.Operations as ScimPatchOp[]).filter((o) => o && typeof o.op === "string") : [];
    const { add, remove, replace, displayName } = groupMemberPatch(ops);
    return { add, remove, replace, ...(displayName ? { displayName } : {}) };
  });
}

export async function DELETE(request: Request, context: Params) {
  return scimGuard(request, async ({ organizationId }) => {
    const { externalRepository, externalAccessService } = getExternalAccess();
    const deleted = await externalRepository.deleteScimGroup(organizationId, (await context.params).id);
    if (!deleted) return scimProblem(404, "Group not found");
    await externalAccessService.resyncScim(organizationId, deleted.memberIds);
    return noContent();
  });
}
