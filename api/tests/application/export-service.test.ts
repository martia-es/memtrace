import { describe, expect, it } from "vitest";
import { AuditService } from "@/application/audit-service";
import { ExportService } from "@/application/export-service";
import type { AuditRepository } from "@/application/ports/audit-repository";
import type { DataExporter } from "@/application/ports/data-exporter";
import { MAX_EXPORT_ROWS } from "@/domain/data-export";
import type { AuditEntryInput } from "@/domain/audit";
import { ExportTooLargeError, ValidationError } from "@/domain/errors";

const input = { organizationId: "org1", scope: { experimentId: "exp1", serviceName: "weather" }, actor: { userId: "u1", email: "ana@example.com" }, kind: "traces", from: "2026-10-01T00:00:00Z", to: "2026-10-02T00:00:00Z" };

function setup(opts: { rows?: number; auditFails?: boolean } = {}) {
  const events: string[] = [];
  const entries: AuditEntryInput[] = [];
  const auditRepo: AuditRepository = {
    append: async (e) => {
      events.push("audit");
      if (opts.auditFails) throw new Error("audit down");
      entries.push(e);
    },
    list: async () => ({ items: [], nextCursor: null }),
    purgeOlderThan: async () => 0,
  };
  const exporter: DataExporter = {
    count: async () => opts.rows ?? 2,
    stream: async function* () {
      events.push("stream-start");
      yield '{"a":1}';
      yield '{"a":2}';
    },
  };
  return { service: new ExportService(exporter, new AuditService(auditRepo)), events, entries };
}

describe("ExportService (ADR-084)", () => {
  it("records the export in the audit log before any data is read", async () => {
    const { service, events, entries } = setup();
    const started = await service.start(input);
    expect(events).toEqual(["audit"]);
    const lines: string[] = [];
    for await (const line of started.lines) lines.push(line);
    expect(lines).toEqual(['{"a":1}', '{"a":2}']);
    expect(events).toEqual(["audit", "stream-start"]);
    expect(entries[0]).toMatchObject({ action: "data.export", actorLabel: "ana@example.com", experimentId: "exp1", metadata: { kind: "traces", rows: 2 } });
    expect(started.filename).toBe("weather-traces-2026-10-01_2026-10-02.jsonl");
  });

  it("an export that cannot be recorded does not happen", async () => {
    const { service, events } = setup({ auditFails: true });
    await expect(service.start(input)).rejects.toThrow("audit down");
    expect(events).not.toContain("stream-start");
  });

  it("asks to narrow the range when there are too many rows, and records nothing", async () => {
    const { service, events } = setup({ rows: MAX_EXPORT_ROWS + 1 });
    await expect(service.start(input)).rejects.toBeInstanceOf(ExportTooLargeError);
    expect(events).toEqual([]);
  });

  it("previews the row count without recording anything or reading data", async () => {
    const { service, events } = setup({ rows: 7 });
    expect(await service.preview(input)).toEqual({ rows: 7, maxRows: MAX_EXPORT_ROWS });
    expect(events).toEqual([]);
    const big = setup({ rows: MAX_EXPORT_ROWS + 5 });
    await expect(big.service.preview(input)).rejects.toBeInstanceOf(ExportTooLargeError);
  });

  it("validates before touching any store", async () => {
    const { service, events } = setup();
    await expect(service.start({ ...input, kind: "secrets" })).rejects.toBeInstanceOf(ValidationError);
    expect(events).toEqual([]);
  });
});
