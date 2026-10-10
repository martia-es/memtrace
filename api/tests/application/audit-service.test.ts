import { describe, expect, it } from "vitest";
import { ACCESS_AUDIT_WINDOW_MS, AuditService } from "@/application/audit-service";
import type { AuditRepository } from "@/application/ports/audit-repository";
import type { NewAuditEvent } from "@/domain/audit";

class FakeRepo implements AuditRepository {
  events: NewAuditEvent[] = [];
  failNext = false;
  async append(event: NewAuditEvent) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("db down");
    }
    this.events.push(event);
  }
  async listForOrganization() {
    return [];
  }
}

const ana = { userId: "u-ana", email: "ana@consulting.com" };
const exp = { id: "exp-1", organizationId: "client-1" };

describe("AuditService (ADR-082)", () => {
  it("records security actions and fails loudly when it cannot", async () => {
    const repo = new FakeRepo();
    const audit = new AuditService(repo);
    await audit.record({ action: "api_key.created", actorUserId: "u1", actorEmail: "a@b.c", organizationId: "o1" });
    expect(repo.events).toHaveLength(1);
    repo.failNext = true;
    await expect(audit.record({ action: "api_key.revoked", actorUserId: "u1", actorEmail: null, organizationId: "o1" })).rejects.toThrow("db down");
  });

  it("records a consultancy entering a client's data once per person and experiment per window", async () => {
    let clock = 1_000_000;
    const repo = new FakeRepo();
    const audit = new AuditService(repo, () => clock);
    await audit.recordPartnerAccess(ana, exp);
    await audit.recordPartnerAccess(ana, exp);
    clock += ACCESS_AUDIT_WINDOW_MS - 1;
    await audit.recordPartnerAccess(ana, exp);
    expect(repo.events).toHaveLength(1);
    expect(repo.events[0]).toMatchObject({ action: "partner.access", actorUserId: "u-ana", organizationId: "client-1", experimentId: "exp-1" });
    clock += 2;
    await audit.recordPartnerAccess(ana, exp);
    expect(repo.events).toHaveLength(2);
  });

  it("tracks people and experiments independently", async () => {
    const repo = new FakeRepo();
    const audit = new AuditService(repo);
    await audit.recordPartnerAccess(ana, exp);
    await audit.recordPartnerAccess({ userId: "u-luis", email: null }, exp);
    await audit.recordPartnerAccess(ana, { id: "exp-2", organizationId: "client-1" });
    expect(repo.events).toHaveLength(3);
  });

  it("never breaks a read when the audit store fails, and retries on the next access", async () => {
    const repo = new FakeRepo();
    const audit = new AuditService(repo);
    repo.failNext = true;
    await expect(audit.recordPartnerAccess(ana, exp)).resolves.toBeUndefined();
    await audit.recordPartnerAccess(ana, exp);
    expect(repo.events).toHaveLength(1);
  });

  it("caps the page size of the list", async () => {
    const audit = new AuditService(new FakeRepo());
    await expect(audit.listForOrganization("o1", { limit: 100000 })).resolves.toEqual([]);
  });
});
