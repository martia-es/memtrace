import { scimBody, scimGuard, scimJson, scimPaging, scimProblem } from "@/adapters/inbound/http/scim-http";
import { getExternalAccess } from "@/dependency-container";
import { listResponse, parseEqFilter, readUserBody, userResource } from "@/domain/scim";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return scimGuard(request, async ({ organizationId, baseUrl }) => {
    const filter = parseEqFilter(new URL(request.url).searchParams.get("filter"));
    const { startIndex, count } = scimPaging(request);
    const { total, items } = await getExternalAccess().externalRepository.listScimUsers(organizationId, {
      ...(filter?.attribute.toLowerCase() === "username" ? { userName: filter.value } : {}),
      startIndex,
      count,
    });
    return scimJson(listResponse(items.map((u) => userResource(baseUrl, u)), total, startIndex));
  });
}

export async function POST(request: Request) {
  return scimGuard(request, async ({ organizationId, baseUrl }) => {
    const input = readUserBody(await scimBody(request));
    if (!input.userName) return scimProblem(400, "userName is required", "invalidValue");
    const { externalRepository, externalAccessService } = getExternalAccess();
    const created = await externalRepository.createScimUser(organizationId, input);
    if (!created) return scimProblem(409, "A user with that userName already exists", "uniqueness");
    await externalAccessService.resyncScim(organizationId, [created.id]);
    return scimJson(userResource(baseUrl, created), 201);
  });
}
