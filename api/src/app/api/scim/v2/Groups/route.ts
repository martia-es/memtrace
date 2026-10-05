import { scimBody, scimGuard, scimJson, scimPaging, scimProblem } from "@/adapters/inbound/http/scim-http";
import { getExternalAccess } from "@/dependency-container";
import { groupResource, listResponse, memberIds, parseEqFilter } from "@/domain/scim";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return scimGuard(request, async ({ organizationId, baseUrl }) => {
    const filter = parseEqFilter(new URL(request.url).searchParams.get("filter"));
    const { startIndex, count } = scimPaging(request);
    const { total, items } = await getExternalAccess().externalRepository.listScimGroups(organizationId, {
      ...(filter?.attribute.toLowerCase() === "displayname" ? { displayName: filter.value } : {}),
      startIndex,
      count,
    });
    return scimJson(listResponse(items.map((g) => groupResource(baseUrl, g)), total, startIndex));
  });
}

export async function POST(request: Request) {
  return scimGuard(request, async ({ organizationId, baseUrl }) => {
    const body = await scimBody(request);
    if (typeof body.displayName !== "string" || !body.displayName.trim()) return scimProblem(400, "displayName is required", "invalidValue");
    const { externalRepository, externalAccessService } = getExternalAccess();
    const created = await externalRepository.createScimGroup(organizationId, {
      displayName: body.displayName.trim(),
      externalId: typeof body.externalId === "string" ? body.externalId : null,
      memberIds: memberIds(body.members),
    });
    if (!created) return scimProblem(409, "A group with that displayName already exists", "uniqueness");
    await externalAccessService.resyncScim(organizationId, created.memberIds);
    return scimJson(groupResource(baseUrl, created), 201);
  });
}
