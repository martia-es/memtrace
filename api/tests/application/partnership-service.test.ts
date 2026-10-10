import { beforeEach, describe, expect, it } from "vitest";
import { PartnershipService } from "@/application/partnership-service";
import type { PartnershipRepository } from "@/application/ports/partnership-repository";
import { PartnershipInvariantError, PartnershipNotFoundError, ValidationError } from "@/domain/errors";
import type { PartnerGrant, Partnership } from "@/domain/partnership";

const CLIENT = "client-org";
const PARTNER = "partner-org";

class FakePartnerships implements PartnershipRepository {
  organizations = new Map<string, string>([[CLIENT, "Acme"], [PARTNER, "Consulting"]]);
  partnerships: Array<Partnership & { revoked: boolean }> = [];
  members = new Map<string, string>([["ana@consulting.com", "u-ana"]]);
  clientExperiments = new Set(["exp-1"]);
  grants: PartnerGrant[] = [];
  revokedGrants = new Set<string>();

  async organizationName(id: string) {
    return this.organizations.get(id) ?? null;
  }
  async listForClient(client: string) {
    return this.partnerships.filter((p) => p.clientOrganizationId === client && !p.revoked);
  }
  async getActive(client: string, id: string) {
    return this.partnerships.find((p) => p.id === id && p.clientOrganizationId === client && !p.revoked) ?? null;
  }
  async create(client: string, partner: string, createdBy: string) {
    if (this.partnerships.some((p) => p.clientOrganizationId === client && p.partnerOrganizationId === partner && !p.revoked)) return null;
    const id = `p-${this.partnerships.length + 1}`;
    this.partnerships.push({ id, clientOrganizationId: client, partnerOrganizationId: partner, partnerOrganizationName: this.organizations.get(partner)!, createdBy, createdAt: "2026-10-10T00:00:00Z", grants: [], revoked: false });
    return { id };
  }
  async revoke(client: string, id: string) {
    const p = this.partnerships.find((x) => x.id === id && x.clientOrganizationId === client && !x.revoked);
    if (!p) return false;
    p.revoked = true;
    return true;
  }
  async findPartnerMember(_partner: string, email: string) {
    const id = this.members.get(email.toLowerCase());
    return id ? { id } : null;
  }
  async experimentBelongsTo(experimentId: string) {
    return this.clientExperiments.has(experimentId);
  }
  async experimentRoleNames() {
    return ["business", "technical"];
  }
  async grant(partnershipId: string, userId: string, input: { role: string; experimentId: string | null }, grantedBy: string): Promise<PartnerGrant> {
    const grant: PartnerGrant = { id: `g-${this.grants.length + 1}`, partnershipId, userId, userEmail: "x", userName: null, role: input.role, experimentId: input.experimentId, grantedBy, createdAt: "2026-10-10T00:00:00Z" };
    this.grants.push(grant);
    return grant;
  }
  async revokeGrant(_partnershipId: string, grantId: string) {
    if (!this.grants.some((g) => g.id === grantId) || this.revokedGrants.has(grantId)) return false;
    this.revokedGrants.add(grantId);
    return true;
  }
  async listClientsForUser() {
    return [];
  }
}

describe("PartnershipService (ADR-080)", () => {
  let repo: FakePartnerships;
  let service: PartnershipService;
  beforeEach(() => {
    repo = new FakePartnerships();
    service = new PartnershipService(repo);
  });

  it("establishes a relationship without granting anything", async () => {
    const partnership = await service.create(CLIENT, PARTNER, "admin");
    expect(partnership).toMatchObject({ partnerOrganizationName: "Consulting", grants: [] });
    expect(repo.grants).toEqual([]);
  });

  it("rejects an organization partnering with itself, an unknown partner and a duplicate", async () => {
    await expect(service.create(CLIENT, CLIENT, "admin")).rejects.toBeInstanceOf(PartnershipInvariantError);
    await expect(service.create(CLIENT, "nobody", "admin")).rejects.toBeInstanceOf(PartnershipNotFoundError);
    await service.create(CLIENT, PARTNER, "admin");
    await expect(service.create(CLIENT, PARTNER, "admin")).rejects.toBeInstanceOf(PartnershipInvariantError);
  });

  it("grants a role to a member of the partner organization, found by email regardless of case", async () => {
    const { id } = await service.create(CLIENT, PARTNER, "admin");
    const grant = await service.grant(CLIENT, id, { email: "ANA@consulting.com", role: "business", experimentId: null }, "admin");
    expect(grant).toMatchObject({ userId: "u-ana", role: "business", experimentId: null, grantedBy: "admin" });
  });

  it("only accepts experiment roles: a partner can never be org_admin of the client", async () => {
    const { id } = await service.create(CLIENT, PARTNER, "admin");
    for (const role of ["org_admin", "governance", "nope"]) {
      await expect(service.grant(CLIENT, id, { email: "ana@consulting.com", role, experimentId: null }, "admin")).rejects.toBeInstanceOf(ValidationError);
    }
    expect(repo.grants).toEqual([]);
  });

  it("only grants people who belong to the partner organization", async () => {
    const { id } = await service.create(CLIENT, PARTNER, "admin");
    await expect(service.grant(CLIENT, id, { email: "stranger@elsewhere.com", role: "business", experimentId: null }, "admin")).rejects.toBeInstanceOf(PartnershipInvariantError);
  });

  it("only scopes a grant to an experiment of the client organization", async () => {
    const { id } = await service.create(CLIENT, PARTNER, "admin");
    await expect(service.grant(CLIENT, id, { email: "ana@consulting.com", role: "business", experimentId: "exp-of-another-client" }, "admin")).rejects.toBeInstanceOf(ValidationError);
    await expect(service.grant(CLIENT, id, { email: "ana@consulting.com", role: "business", experimentId: "exp-1" }, "admin")).resolves.toMatchObject({ experimentId: "exp-1" });
  });

  it("cannot touch a relationship that belongs to another client", async () => {
    const { id } = await service.create(CLIENT, PARTNER, "admin");
    await expect(service.grant("other-client", id, { email: "ana@consulting.com", role: "business", experimentId: null }, "evil")).rejects.toBeInstanceOf(PartnershipNotFoundError);
    await expect(service.revoke("other-client", id, "evil")).rejects.toBeInstanceOf(PartnershipNotFoundError);
    await expect(service.revokeGrant("other-client", id, "g-1", "evil")).rejects.toBeInstanceOf(PartnershipNotFoundError);
  });

  it("revokes a grant once, then reports it as unknown", async () => {
    const { id } = await service.create(CLIENT, PARTNER, "admin");
    const grant = await service.grant(CLIENT, id, { email: "ana@consulting.com", role: "business", experimentId: null }, "admin");
    await service.revokeGrant(CLIENT, id, grant.id, "admin");
    await expect(service.revokeGrant(CLIENT, id, grant.id, "admin")).rejects.toBeInstanceOf(PartnershipNotFoundError);
  });

  it("does not grant on a revoked relationship", async () => {
    const { id } = await service.create(CLIENT, PARTNER, "admin");
    await service.revoke(CLIENT, id, "admin");
    await expect(service.grant(CLIENT, id, { email: "ana@consulting.com", role: "business", experimentId: null }, "admin")).rejects.toBeInstanceOf(PartnershipNotFoundError);
  });
});
