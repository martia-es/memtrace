import { noContent, scimBody, scimGuard, scimJson, scimProblem } from "@/adapters/inbound/http/scim-http";
import { getExternalAccess } from "@/dependency-container";
import { readUserBody, userPatch, userResource, type ScimPatchOp } from "@/domain/scim";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  return scimGuard(request, async ({ organizationId, baseUrl }) => {
    const user = await getExternalAccess().externalRepository.getScimUser(organizationId, (await context.params).id);
    return user ? scimJson(userResource(baseUrl, user)) : scimProblem(404, "User not found");
  });
}

/** Sustituye el usuario entero. Si queda inactivo pierde al instante el acceso que le daban sus grupos. */
export async function PUT(request: Request, context: Params) {
  return scimGuard(request, async ({ organizationId, baseUrl }) => {
    const { id } = await context.params;
    const input = readUserBody(await scimBody(request));
    if (!input.userName) return scimProblem(400, "userName is required", "invalidValue");
    const { externalRepository, externalAccessService } = getExternalAccess();
    const updated = await externalRepository.updateScimUser(organizationId, id, input);
    if (!updated) return scimProblem(404, "User not found");
    await externalAccessService.resyncScim(organizationId, [id]);
    return scimJson(userResource(baseUrl, updated));
  });
}

/** El caso habitual: el proveedor de identidad pone `active` a false al dar de baja a alguien. */
export async function PATCH(request: Request, context: Params) {
  return scimGuard(request, async ({ organizationId, baseUrl }) => {
    const { id } = await context.params;
    const body = await scimBody(request);
    const ops = Array.isArray(body.Operations) ? (body.Operations as ScimPatchOp[]).filter((o) => o && typeof o.op === "string") : [];
    const { externalRepository, externalAccessService } = getExternalAccess();
    const updated = await externalRepository.updateScimUser(organizationId, id, userPatch(ops));
    if (!updated) return scimProblem(404, "User not found");
    await externalAccessService.resyncScim(organizationId, [id]);
    return scimJson(userResource(baseUrl, updated));
  });
}

/** Borrar el usuario SCIM retira todo lo que SCIM le había dado; sus membresías manuales se conservan. */
export async function DELETE(request: Request, context: Params) {
  return scimGuard(request, async ({ organizationId }) => {
    const { externalRepository, externalAccessService } = getExternalAccess();
    const deleted = await externalRepository.deleteScimUser(organizationId, (await context.params).id);
    if (!deleted) return scimProblem(404, "User not found");
    await externalAccessService.revokeScim(organizationId, deleted.userId);
    return noContent();
  });
}
