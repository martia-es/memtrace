import { describe, expect, it } from "vitest";
import { ExternalAccessService } from "@/application/external-access-service";
import type { ExternalIdentityRepository, MappedOrganization, ScimUserMembership } from "@/application/ports/external-identity-repository";
import type { ExternalGrant, ExternalMapping, ExternalSource } from "@/domain/external-access";

const mapping = (externalGroup: string, role: string, experimentId: string | null): ExternalMapping => ({ id: externalGroup, organizationId: "o1", externalGroup, experimentId, role, createdAt: "" });

function setup(opts: { mappings?: ExternalMapping[]; claim?: string; scim?: ScimUserMembership[] } = {}) {
  const mappings = opts.mappings ?? [mapping("ai-team", "technical", "e1")];
  const calls: Array<{ userId: string; organizationId: string; source: ExternalSource; grants: ExternalGrant[] }> = [];
  const linked: string[] = [];
  const repo = {
    linkScimUsersByEmail: async (_u: string, email: string) => (linked.push(email), []),
    scimMemberships: async () => opts.scim ?? [],
    roleWeights: async () => new Map([["technical", 8], ["business", 2]]),
    listMappedOrganizations: async (): Promise<MappedOrganization[]> => [{ organizationId: "o1", groupsClaim: opts.claim ?? "groups", mappings }],
    listMappings: async () => mappings,
    reconcile: async (userId: string, organizationId: string, source: ExternalSource, grants: ExternalGrant[]) => void calls.push({ userId, organizationId, source, grants }),
    purgeExternal: async () => {},
  } as unknown as ExternalIdentityRepository;
  return { service: new ExternalAccessService(repo), calls, linked };
}

describe("ExternalAccessService", () => {
  it("gives a person the roles of the groups in their token at login", async () => {
    const { service, calls, linked } = setup();
    await service.onLogin("u1", "ana@x.com", { groups: ["ai-team", "other"] });
    expect(linked).toEqual(["ana@x.com"]);
    expect(calls).toEqual([{ userId: "u1", organizationId: "o1", source: "oidc", grants: [{ experimentId: "e1", role: "technical" }] }]);
  });

  it("removes access when the token says the person is in no mapped group", async () => {
    const { service, calls } = setup();
    await service.onLogin("u1", "ana@x.com", { groups: [] });
    expect(calls[0]!.grants).toEqual([]);
  });

  it("changes nothing when the token has no groups claim (Google, or a token with group overage)", async () => {
    const { service, calls } = setup();
    await service.onLogin("u1", "ana@x.com", { email: "ana@x.com" });
    expect(calls).toEqual([]);
  });

  it("reads the claim the organization configured", async () => {
    const { service, calls } = setup({ claim: "roles" });
    await service.onLogin("u1", null, { roles: ["ai-team"] });
    expect(calls).toHaveLength(1);
  });

  it("applies SCIM groups to linked, active users and strips deactivated ones at once", async () => {
    const { service, calls } = setup({
      scim: [
        { scimUserId: "s1", organizationId: "o1", userId: "u1", active: true, groups: ["ai-team"] },
        { scimUserId: "s2", organizationId: "o1", userId: "u2", active: false, groups: ["ai-team"] },
        { scimUserId: "s3", organizationId: "o1", userId: null, active: true, groups: ["ai-team"] },
      ],
    });
    await service.resyncScim("o1");
    expect(calls).toEqual([
      { userId: "u1", organizationId: "o1", source: "scim", grants: [{ experimentId: "e1", role: "technical" }] },
      { userId: "u2", organizationId: "o1", source: "scim", grants: [] },
    ]);
  });

  it("revokes everything SCIM gave to a deleted user", async () => {
    const { service, calls } = setup();
    await service.revokeScim("o1", "u9");
    expect(calls).toEqual([{ userId: "u9", organizationId: "o1", source: "scim", grants: [] }]);
  });
});
