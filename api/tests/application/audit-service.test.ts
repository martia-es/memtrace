import { describe, expect, it, vi } from "vitest";
import { AuditService } from "@/application/audit-service";
import type { AuditRepository } from "@/application/ports/audit-repository";
import { MAX_METADATA_CHARS, type AuditEntryInput } from "@/domain/audit";
import { ValidationError } from "@/domain/errors";

const entry = (over: Partial<AuditEntryInput> = {}): AuditEntryInput => ({
  organizationId: "org1",
  experimentId: "exp1",
  actorUserId: "u1",
  actorLabel: "ana@example.com",
  action: "trace.view",
  targetType: "trace",
  targetId: "abc",
  metadata: {},
  ...over,
});

describe("AuditService", () => {
  it("record fails loudly, recordBestEffort does not", async () => {
    const repo: AuditRepository = { append: async () => Promise.reject(new Error("db down")), list: async () => ({ items: [], nextCursor: null }), purgeOlderThan: async () => 0 };
    const service = new AuditService(repo);
    await expect(service.record(entry())).rejects.toThrow("db down");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(service.recordBestEffort(entry())).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("refuses metadata that looks like content instead of a summary", async () => {
    const appended: AuditEntryInput[] = [];
    const service = new AuditService({ append: async (e) => void appended.push(e), list: async () => ({ items: [], nextCursor: null }), purgeOlderThan: async () => 0 });
    await expect(service.record(entry({ metadata: { text: "x".repeat(MAX_METADATA_CHARS + 1) } }))).rejects.toBeInstanceOf(ValidationError);
    expect(appended).toHaveLength(0);
  });

  it("caps the page size", async () => {
    const limits: number[] = [];
    const service = new AuditService({ append: async () => undefined, list: async (_o, _f, limit) => (limits.push(limit), { items: [], nextCursor: null }), purgeOlderThan: async () => 0 });
    await service.list("org1", {}, { limit: 100000 });
    await service.list("org1", {}, { limit: 0 });
    await service.list("org1", {});
    expect(limits).toEqual([200, 1, 50]);
  });
});
