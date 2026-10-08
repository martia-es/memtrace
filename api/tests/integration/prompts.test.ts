/**
 * Contra un Postgres real (15+) con las migraciones 001-032 aplicadas. Opt-in: `POSTGRES_INTEGRATION_URL=postgres://… npm run test:integration`.
 * Cubre lo que los fakes no pueden: las restricciones de la migración 032 (nombre único por organización, versiones
 * inmutables, numeración atómica), los tags con su historial, el prompt de varios agentes y los permisos por rol (ADR-067).
 */
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresIdentityRepository } from "@/adapters/outbound/postgres/postgres-identity-repository";
import { PostgresPromptRepository } from "@/adapters/outbound/postgres/postgres-prompt-repository";
import { PromptService } from "@/application/prompt-service";
import { PromptInvariantError, PromptNotFoundError, PromptPromoteForbiddenError } from "@/domain/errors";

const url = process.env.POSTGRES_INTEGRATION_URL;

describe.skipIf(!url)("prompt registry (postgres)", () => {
  let pool: Pool;
  let service: PromptService;
  let identity: PostgresIdentityRepository;
  let orgId: string;
  let otherOrgId: string;
  let agentA: string;
  let agentB: string;
  let foreignAgent: string;
  let userId: string;
  const stamp = Date.now();

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    identity = new PostgresIdentityRepository(pool);
    service = new PromptService(new PostgresPromptRepository(pool));
    userId = (await pool.query<{ id: string }>(`INSERT INTO users (email, name) VALUES ($1, 'Owner') RETURNING id`, [`prompts-${stamp}@example.com`])).rows[0]!.id;
    orgId = (await identity.createOrganization(`prompts-org-${stamp}`, userId)).id;
    otherOrgId = (await identity.createOrganization(`prompts-other-${stamp}`, userId)).id;
    agentA = (await identity.createExperiment(orgId, "weather", `weather-${stamp}`)).id;
    agentB = (await identity.createExperiment(orgId, "geo", `geo-${stamp}`)).id;
    foreignAgent = (await identity.createExperiment(otherOrgId, "other", `other-${stamp}`)).id;
  });
  afterAll(async () => {
    await pool.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [[orgId, otherOrgId]]);
    await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`%-${stamp}@example.com`]);
    await pool.end();
  });

  it("creates a prompt with version 1 linked to its agents", async () => {
    const detail = await service.create(orgId, userId, { name: "create-basic", content: "Hola {{nombre}}", experimentIds: [agentA, agentB] });
    expect(detail.prompt.experimentIds.sort()).toEqual([agentA, agentB].sort());
    expect(detail.versions[0]).toMatchObject({ version: 1, variables: ["nombre"], parentVersion: null });
    expect(detail.environmentKeys).toEqual(["dev", "pre", "pro"]);
  });

  it("refuses a repeated name in the same organization but allows it in another", async () => {
    await service.create(orgId, userId, { name: "dup-name", content: "uno" });
    await expect(service.create(orgId, userId, { name: "dup-name", content: "dos" })).rejects.toBeInstanceOf(PromptInvariantError);
    await expect(service.create(otherOrgId, userId, { name: "dup-name", content: "tres" })).resolves.toBeDefined();
  });

  it("does not leave a half-created prompt when the first version fails", async () => {
    await expect(pool.query(`INSERT INTO prompt_versions (prompt_id, version, content, content_hash) VALUES (gen_random_uuid(), 1, 'x', 'h')`)).rejects.toBeDefined();
    const before = (await pool.query(`SELECT count(*)::int AS n FROM prompts WHERE organization_id = $1`, [orgId])).rows[0].n as number;
    await expect(service.create(orgId, userId, { name: "tx-blank", content: "   " })).rejects.toBeDefined();
    expect((await pool.query(`SELECT count(*)::int AS n FROM prompts WHERE organization_id = $1`, [orgId])).rows[0].n).toBe(before);
  });

  it("rejects agents from another organization", async () => {
    await expect(service.create(orgId, userId, { name: "foreign-agent", content: "x", experimentIds: [foreignAgent] })).rejects.toBeInstanceOf(PromptInvariantError);
  });

  it("numbers concurrent saves without gaps or duplicates", async () => {
    const { prompt } = await service.create(orgId, userId, { name: "concurrent", content: "v1" });
    const saves = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => service.saveVersion(prompt.id, userId, { content: `contenido ${i}`, parentVersion: 1 })));
    expect(saves.every((s) => s.status === "fulfilled")).toBe(true);
    const numbers = (await service.detail(prompt.id)).versions.map((v) => v.version).sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("versions are immutable in the database", async () => {
    const { prompt } = await service.create(orgId, userId, { name: "immutable", content: "original" });
    await expect(pool.query(`UPDATE prompt_versions SET content = 'editado' WHERE prompt_id = $1`, [prompt.id])).rejects.toThrow(/immutable/);
    expect((await service.detail(prompt.id)).versions[0]!.content).toBe("original");
  });

  it("moves tags with history, resolves by tag and removes them", async () => {
    const { prompt } = await service.create(orgId, userId, { name: "tags", content: "uno" });
    await service.saveVersion(prompt.id, userId, { content: "dos" });
    await service.moveTag(prompt.id, userId, { tag: "dev", version: 1 }, true);
    await service.moveTag(prompt.id, userId, { tag: "dev", version: 2, reason: "better tone" }, true);
    expect((await service.resolve(prompt.id, "dev")).content).toBe("dos");
    const listed = (await service.list(orgId, { experimentId: undefined })).find((p) => p.id === prompt.id)!;
    expect(listed).toMatchObject({ latestVersion: 2, tags: { dev: 2 } });
    await service.moveTag(prompt.id, userId, { tag: "dev", version: null }, true);
    const { events, tags } = await service.detail(prompt.id);
    expect(tags).toEqual([]);
    expect(events.map((e) => [e.tag, e.fromVersion, e.toVersion])).toEqual([["dev", 2, null], ["dev", 1, 2], ["dev", null, 1]]);
  });

  it("environment tags are the organization's environments", async () => {
    const { prompt } = await service.create(orgId, userId, { name: "env-tags", content: "uno" });
    await expect(service.moveTag(prompt.id, userId, { tag: "pro", version: 1 }, false)).rejects.toBeInstanceOf(PromptPromoteForbiddenError);
    await expect(service.moveTag(prompt.id, userId, { tag: "stable", version: 1 }, false)).resolves.toBeDefined();
  });

  it("archives without losing the history and filters by agent", async () => {
    const { prompt } = await service.create(orgId, userId, { name: "archivable", content: "uno", experimentIds: [agentB] });
    expect((await service.list(orgId, { experimentId: agentB })).map((p) => p.id)).toContain(prompt.id);
    await service.update(prompt.id, { archived: true });
    expect((await service.list(orgId, { experimentId: agentB })).map((p) => p.id)).not.toContain(prompt.id);
    expect((await service.list(orgId, { experimentId: agentB, includeArchived: true })).map((p) => p.id)).toContain(prompt.id);
    expect((await service.detail(prompt.id)).versions).toHaveLength(1);
  });

  it("deleting an agent unlinks it without touching the prompt", async () => {
    const extra = (await identity.createExperiment(orgId, "temp", `temp-${stamp}`)).id;
    const { prompt } = await service.create(orgId, userId, { name: "unlink", content: "uno", experimentIds: [extra, agentA] });
    await pool.query(`DELETE FROM experiments WHERE id = $1`, [extra]);
    expect((await service.get(prompt.id)).experimentIds).toEqual([agentA]);
  });

  it("role permissions: technical writes and promotes, business only reads, governance only reads", async () => {
    const { rows } = await pool.query<{ role_name: string; permission: string }>(`SELECT role_name, permission FROM role_permissions WHERE permission LIKE 'prompt:%' ORDER BY 1, 2`);
    const by = (role: string) => rows.filter((r) => r.role_name === role).map((r) => r.permission);
    expect(by("technical")).toEqual(["prompt:promote", "prompt:read", "prompt:write"]);
    expect(by("org_admin")).toEqual(["prompt:promote", "prompt:read", "prompt:write"]);
    expect(by("business")).toEqual(["prompt:read"]);
    expect(by("governance")).toEqual(["prompt:read"]);
  });

  it("serves the prompt to the agents it belongs to, by tag or version, and to nobody else", async () => {
    const { prompt } = await service.create(orgId, userId, { name: "resolve-me", content: "hola", experimentIds: [agentA] });
    await service.moveTag(prompt.id, userId, { tag: "pro", version: 1 }, true);
    const resolved = await service.resolveForAgent(agentA, orgId, "resolve-me", { tag: "pro" });
    expect(resolved).toMatchObject({ tag: "pro", version: { version: 1, content: "hola" } });
    await expect(service.resolveForAgent(agentB, orgId, "resolve-me", { tag: "pro" })).rejects.toBeInstanceOf(PromptNotFoundError);
    await expect(service.resolveForAgent(agentA, otherOrgId, "resolve-me", { tag: "pro" })).rejects.toBeInstanceOf(PromptNotFoundError);
  });

  it("keeps one row per (agent, environment, tag, version) and refreshes it on every report", async () => {
    const { prompt } = await service.create(orgId, userId, { name: "usage-rows", content: "uno", experimentIds: [agentA] });
    await service.saveVersion(prompt.id, userId, { content: "dos" });
    const report = (version: number) => service.recordUsage(agentA, orgId, "pro", [{ name: "usage-rows", tag: "pro", version }]);
    expect(await report(1)).toBe(1);
    const first = (await service.detail(prompt.id)).usage;
    expect(first).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await report(1);
    const second = (await service.detail(prompt.id)).usage;
    expect(second).toHaveLength(1);
    expect(Date.parse(second[0]!.lastSeenAt)).toBeGreaterThan(Date.parse(first[0]!.lastSeenAt));
    expect(second[0]!.firstSeenAt).toBe(first[0]!.firstSeenAt);
    // durante una actualización escalonada se ven las dos versiones a la vez
    await report(2);
    expect((await service.detail(prompt.id)).usage.map((u) => u.version).sort()).toEqual([1, 2]);
  });

  it("forgets reports older than a week and drops usage together with the agent", async () => {
    const extra = (await identity.createExperiment(orgId, "usage-agent", `usage-agent-${stamp}`)).id;
    const { prompt } = await service.create(orgId, userId, { name: "usage-old", content: "uno", experimentIds: [agentA, extra] });
    await service.recordUsage(agentA, orgId, "dev", [{ name: "usage-old", tag: "dev", version: 1 }]);
    await service.recordUsage(extra, orgId, "dev", [{ name: "usage-old", tag: "dev", version: 1 }]);
    await pool.query(`UPDATE prompt_usage SET last_seen_at = now() - interval '8 days' WHERE prompt_id = $1 AND experiment_id = $2`, [prompt.id, agentA]);
    expect((await service.detail(prompt.id)).usage.map((u) => u.experimentId)).toEqual([extra]);
    await pool.query(`DELETE FROM experiments WHERE id = $1`, [extra]);
    expect((await service.detail(prompt.id)).usage).toEqual([]);
  });
});
