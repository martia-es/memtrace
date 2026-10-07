/**
 * Contra un Postgres real (15+) con las migraciones 001-022 aplicadas. Opt-in: `POSTGRES_INTEGRATION_URL=postgres://… npm run test:integration`.
 * Cubre lo que los fakes no pueden: las restricciones de la migración 021, el entorno resuelto por organización,
 * el estado de salud con fallos seguidos, la sincronización de conexiones observadas y los permisos de organización (ADR-053).
 */
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresAssistantRegistryRepository } from "@/adapters/outbound/postgres/postgres-assistant-registry-repository";
import { PostgresIdentityRepository } from "@/adapters/outbound/postgres/postgres-identity-repository";
import { AssistantInvariantError } from "@/domain/errors";

const url = process.env.POSTGRES_INTEGRATION_URL;

describe.skipIf(!url)("assistant registry (postgres)", () => {
  let pool: Pool;
  let repo: PostgresAssistantRegistryRepository;
  let identity: PostgresIdentityRepository;
  let orgId: string;
  let otherOrgId: string;
  let experimentId: string;
  let peerId: string;
  let userId: string;
  const stamp = Date.now();
  const base = { healthUrl: null, version: "v1", authMethod: "oauth2" as const, authProvider: "Entra ID", authAudience: "api://x", healthCheckEnabled: true, healthIntervalSeconds: null, deployRef: null };
  const ok = { httpStatus: 200, latencyMs: 80, error: null };
  const fail = { httpStatus: null, latencyMs: null, error: "timeout" };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    repo = new PostgresAssistantRegistryRepository(pool);
    identity = new PostgresIdentityRepository(pool);
    userId = (await pool.query<{ id: string }>(`INSERT INTO users (email, name) VALUES ($1, 'Owner') RETURNING id`, [`owner-${stamp}@example.com`])).rows[0]!.id;
    orgId = (await identity.createOrganization(`gov-org-${stamp}`, userId)).id;
    otherOrgId = (await identity.createOrganization(`gov-other-${stamp}`, userId)).id;
    experimentId = (await identity.createExperiment(orgId, "weather", `weather-${stamp}`, { description: "Weather answers", ownerUserId: userId })).id;
    peerId = (await identity.createExperiment(orgId, "geo", `geo-${stamp}`)).id;
  });
  afterAll(async () => {
    await pool.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [[orgId, otherOrgId]]);
    await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`%-${stamp}@example.com`]);
    await pool.end();
  });

  it("seeds DEV/PRE/PRO in a new organization, only PRO as production", async () => {
    const envs = await repo.listEnvironments(orgId);
    expect(envs.map((e) => [e.label, e.isProduction, e.healthIntervalSeconds])).toEqual([["DEV", false, 300], ["PRE", false, 300], ["PRO", true, 60]]);
  });

  it("gives every experiment its card at creation: no registration step (ADR-054)", async () => {
    const card = (await repo.getCard(experimentId))!;
    expect(card).toMatchObject({ name: "weather", description: "Weather answers", lifecycle: "active", status: null });
    expect(card.owner).toMatchObject({ id: userId, name: "Owner" });
    const bare = (await repo.getCard(peerId))!;
    expect(bare).toMatchObject({ description: "", owner: null, deployments: [] });
    expect(await repo.getCard("00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(await repo.getCard("not-a-uuid")).toBeNull();
  });

  it("lists who takes part in the experiment, technical first, with their photo", async () => {
    const mk = async (label: string, image: string | null) => (await pool.query<{ id: string }>(`INSERT INTO users (email, name, image) VALUES ($1, $2, $3) RETURNING id`, [`${label}-${stamp}@example.com`, label, image])).rows[0]!.id;
    const biz = await mk("biz", "https://photos.example/biz.png");
    const tech = await mk("tech", null);
    await identity.addExperimentMember(peerId, biz, "business");
    await identity.addExperimentMember(peerId, tech, "technical");
    const { members } = (await repo.getCard(peerId))!;
    expect(members.total).toBe(2);
    expect(members.preview.map((m) => [m.name, m.role, m.image])).toEqual([["tech", "technical", null], ["biz", "business", "https://photos.example/biz.png"]]);
    for (let i = 0; i < 4; i++) await identity.addExperimentMember(peerId, await mk(`extra${i}`, null), "business");
    const many = (await repo.getCard(peerId))!.members;
    expect(many.total).toBe(6);
    expect(many.preview).toHaveLength(4);
  });

  it("edits the card on the experiment itself", async () => {
    const edited = (await repo.update(peerId, { description: "Finds places", lifecycle: "active" }))!;
    expect(edited).toMatchObject({ description: "Finds places" });
    expect(await repo.update("00000000-0000-0000-0000-000000000000", { description: "x" })).toBeNull();
    const { rows } = await pool.query(`SELECT description FROM experiments WHERE id = $1`, [peerId]);
    expect(rows[0]).toEqual({ description: "Finds places" });
  });

  it("creates one deployment per environment and never uses an environment of another organization", async () => {
    const pro = await repo.createDeployment(experimentId, { ...base, environmentKey: "pro", apiUrl: "https://api.acme.test/weather" });
    expect(pro.healthStatus).toBe("unknown");
    await expect(repo.createDeployment(experimentId, { ...base, environmentKey: "pro", apiUrl: "https://again.acme.test" })).rejects.toBeInstanceOf(AssistantInvariantError);
    await expect(repo.createDeployment(experimentId, { ...base, environmentKey: "staging", apiUrl: "https://s.acme.test" })).rejects.toBeInstanceOf(AssistantInvariantError);
    // el mismo `key` existe en la otra organización, pero esa no es la del experimento
    const otherEnvs = await repo.listEnvironments(otherOrgId);
    const dev = await repo.createDeployment(experimentId, { ...base, environmentKey: "dev", apiUrl: "https://dev.acme.test" });
    expect(dev.environmentId).not.toBe(otherEnvs.find((e) => e.key === "dev")!.id);
  });

  it("rejects an api_url that is not http(s) at the database level too", async () => {
    await expect(pool.query(`UPDATE assistant_deployments SET api_url = 'ftp://x' WHERE experiment_id = $1`, [experimentId])).rejects.toThrow();
  });

  it("holds a healthy deployment up after one failure and turns it down after two, keeping the history", async () => {
    const card = (await repo.getCard(experimentId))!;
    const pro = card.deployments.find((d) => d.environment.key === "pro")!;
    expect(await repo.recordProbe(pro.id, ok, new Date())).toEqual({ previous: "unknown", current: "up" });
    expect(await repo.recordProbe(pro.id, fail, new Date())).toEqual({ previous: "up", current: "up" });
    expect(await repo.recordProbe(pro.id, fail, new Date())).toEqual({ previous: "up", current: "down" });
    const after = (await repo.getDeployment(experimentId, pro.id))!;
    expect(after).toMatchObject({ healthStatus: "down", healthConsecutiveFailures: 2 });
    const history = (await repo.listHealthChecks(experimentId, pro.id, new Date(Date.now() - 3_600_000), 10))!;
    expect(history.map((h) => h.status)).toEqual(["down", "down", "up"]);
    expect((await repo.getCard(experimentId))!.status).toBe("down");
    expect(await repo.pruneHealthChecks(new Date(Date.now() + 1000))).toBeGreaterThanOrEqual(3);
  });

  it("summarizes the last 24 hours in buckets, with the worst status of each and the uptime", async () => {
    const dev = (await repo.getCard(experimentId))!.deployments.find((d) => d.environment.key === "dev")!;
    await pool.query(`DELETE FROM deployment_health_checks WHERE deployment_id = $1`, [dev.id]);
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);
    await repo.recordProbe(dev.id, ok, ago(23 * 60));
    await repo.recordProbe(dev.id, { httpStatus: 200, latencyMs: 4000, error: null }, ago(23 * 60 - 5));
    await repo.recordProbe(dev.id, ok, ago(60));
    const recent = (await repo.getCard(experimentId))!.deployments.find((d) => d.id === dev.id)!.recent;
    expect(recent.buckets).toHaveLength(36);
    expect(recent.buckets[1]).toBe("degraded"); // el peor de los dos primeros sondeos
    expect(recent.buckets[34]).toBe("up");
    expect(recent.buckets.filter((b) => b !== null)).toHaveLength(2);
    expect(recent.uptimePercent).toBe(100);
    const empty = (await repo.getCard(experimentId))!.deployments.find((d) => d.environment.key === "pro")!;
    expect(empty.recent.buckets.every((b) => b === null || b === "up" || b === "down")).toBe(true);
    await pool.query(`DELETE FROM deployment_health_checks WHERE deployment_id = $1`, [dev.id]);
    await pool.query(`UPDATE assistant_deployments SET health_checked_at = NULL, health_status = 'unknown' WHERE id = $1`, [dev.id]);
  });

  it("lists as due only enabled deployments whose interval has passed", async () => {
    const dev = (await repo.getCard(experimentId))!.deployments.find((d) => d.environment.key === "dev")!;
    const now = new Date();
    expect((await repo.listDueDeployments(now, 100)).some((t) => t.deploymentId === dev.id && t.url === "https://dev.acme.test/health")).toBe(true);
    await repo.recordProbe(dev.id, ok, now);
    expect((await repo.listDueDeployments(now, 100)).some((t) => t.deploymentId === dev.id)).toBe(false);
    expect((await repo.listDueDeployments(new Date(now.getTime() + 301_000), 100)).some((t) => t.deploymentId === dev.id)).toBe(true);
    await repo.updateDeployment(experimentId, dev.id, { healthCheckEnabled: false });
    expect((await repo.listDueDeployments(new Date(now.getTime() + 301_000), 100)).some((t) => t.deploymentId === dev.id)).toBe(false);
  });

  it("keeps declared and observed apart, and counts only pending observed ones for review", async () => {
    await repo.declareConnection(experimentId, { kind: "mcp_server", name: "weather-mcp" });
    await repo.declareConnection(experimentId, { kind: "tool", name: "get_forecast", via: "weather-mcp" });
    await repo.recordObservedConnections(experimentId, [{ kind: "tool", name: "get_forecast" }, { kind: "tool", name: "search_web" }], new Date("2026-10-03T10:00:00Z"));
    await repo.recordObservedConnections(experimentId, [{ kind: "tool", name: "search_web" }], new Date("2026-10-05T10:00:00Z"));
    const list = await repo.listConnections(experimentId);
    const search = list.find((c) => c.name === "search_web")!;
    expect(search).toMatchObject({ declared: false, status: "pending", firstSeenAt: "2026-10-03T10:00:00.000Z", lastSeenAt: "2026-10-05T10:00:00.000Z" });
    expect(list.find((c) => c.name === "get_forecast")).toMatchObject({ declared: true, via: "weather-mcp" });
    expect((await repo.getCard(experimentId))!.connectionCounts).toEqual({ mcpServers: 1, tools: 2, agents: 0, toReview: 2 });
    expect((await repo.getCard(experimentId))!.mcpServerNames).toEqual(["weather-mcp"]);

    await repo.decideConnection(experimentId, search.id, "blocked", userId, "Not allowed in production");
    expect((await repo.getCard(experimentId))!.connectionCounts.toReview).toBe(1);
  });

  it("drops a declaration that was never seen but keeps one that was, as observed only", async () => {
    const list = await repo.listConnections(experimentId);
    const neverSeen = list.find((c) => c.name === "weather-mcp")!;
    const seen = list.find((c) => c.name === "get_forecast")!;
    expect(await repo.undeclareConnection(experimentId, neverSeen.id)).toBe(true);
    expect(await repo.undeclareConnection(experimentId, seen.id)).toBe(true);
    const after = await repo.listConnections(experimentId);
    expect(after.some((c) => c.name === "weather-mcp")).toBe(false);
    expect(after.find((c) => c.name === "get_forecast")).toMatchObject({ declared: false });
  });

  it("points an agent to another experiment of the organization, never to one of another organization", async () => {
    const agent = await repo.declareConnection(experimentId, { kind: "agent", name: "geo", peerExperimentId: peerId });
    expect(agent.peerExperimentId).toBe(peerId);
    const foreign = (await identity.createExperiment(otherOrgId, "foreign", `foreign-${stamp}`)).id;
    await expect(repo.declareConnection(experimentId, { kind: "agent", name: "foreign", peerExperimentId: foreign })).rejects.toBeInstanceOf(AssistantInvariantError);
    await expect(repo.declareConnection(experimentId, { kind: "agent", name: "ghost", peerExperimentId: "00000000-0000-0000-0000-000000000000" })).rejects.toBeInstanceOf(AssistantInvariantError);
  });

  it("stores grants by type, refuses duplicates and summarizes them on the card", async () => {
    const pro = (await repo.getCard(experimentId))!.deployments.find((d) => d.environment.key === "pro")!;
    await repo.addGrant(experimentId, pro.id, { subjectType: "group", externalGroup: "Support-Agents", memberCount: 214 }, userId);
    await repo.addGrant(experimentId, pro.id, { subjectType: "user", userId }, userId);
    await repo.addGrant(experimentId, pro.id, { subjectType: "everyone" }, userId);
    await expect(repo.addGrant(experimentId, pro.id, { subjectType: "group", externalGroup: "Support-Agents" }, userId)).rejects.toBeInstanceOf(AssistantInvariantError);
    await expect(repo.addGrant(experimentId, pro.id, { subjectType: "everyone" }, userId)).rejects.toBeInstanceOf(AssistantInvariantError);
    expect((await repo.getCard(experimentId))!.deployments.find((d) => d.id === pro.id)!.access).toEqual({ everyone: true, groups: 1, users: 1 });
    const grants = (await repo.listGrants(experimentId, pro.id))!;
    expect(await repo.removeGrant(experimentId, pro.id, grants[0]!.id)).toBe(true);
    expect(await repo.removeGrant(experimentId, pro.id, grants[0]!.id)).toBe(false);
  });

  it("returns who a user grant is for and finds people of the organization by name or email", async () => {
    const pro = (await repo.getCard(experimentId))!.deployments.find((d) => d.environment.key === "pro")!;
    const grant = (await repo.addGrant(experimentId, pro.id, { subjectType: "user", userId }, userId))!;
    expect(grant.user).toEqual({ userId, name: "Owner", email: `owner-${stamp}@example.com`, image: null });
    await repo.removeGrant(experimentId, pro.id, grant.id);

    expect((await repo.searchPeople(experimentId, `OWNER-${stamp}`, 10))!.map((p) => p.userId)).toEqual([userId]);
    expect((await repo.searchPeople(experimentId, "Owner", 10))!.map((p) => p.userId)).toContain(userId);
    expect(await repo.searchPeople(experimentId, "%", 10)).toEqual([]);
    expect(await repo.searchPeople("not-a-uuid", "owner", 10)).toBeNull();
  });

  it("treats a deployment of another experiment as not found", async () => {
    const pro = (await repo.getCard(experimentId))!.deployments.find((d) => d.environment.key === "pro")!;
    expect(await repo.getDeployment(peerId, pro.id)).toBeNull();
    expect(await repo.listGrants(peerId, pro.id)).toBeNull();
    expect(await repo.deleteDeployment(peerId, pro.id)).toBe(false);
    expect(await repo.getDeployment(experimentId, "not-a-uuid")).toBeNull();
  });

  it("lists the catalog of an organization only, with the owner", async () => {
    const catalog = await repo.listCatalog(orgId);
    expect(catalog.map((c) => c.name)).toEqual(["geo", "weather"]);
    expect(catalog.find((c) => c.name === "weather")!.owner).toMatchObject({ id: userId, name: "Owner" });
    expect((await repo.listCatalog(otherOrgId)).map((c) => c.name)).toEqual(["foreign"]);
  });

  it("gives organization permissions by role, so a governance member is not an org admin (ADR-053)", async () => {
    const gov = (await pool.query<{ id: string }>(`INSERT INTO users (email) VALUES ($1) RETURNING id`, [`gov-${stamp}@example.com`])).rows[0]!.id;
    await pool.query(`INSERT INTO org_memberships (organization_id, user_id, role) VALUES ($1, $2, 'governance')`, [orgId, gov]);
    expect(await identity.hasOrganizationPermission(gov, orgId, "governance:read")).toBe(true);
    expect(await identity.hasOrganizationPermission(gov, orgId, "governance:manage")).toBe(true);
    expect(await identity.hasOrganizationPermission(gov, orgId, "org:manage")).toBe(false);
    expect(await identity.isOrgAdmin(gov, orgId)).toBe(false);
    expect(await identity.isOrgAdmin(userId, orgId)).toBe(true);
    expect(await identity.hasOrganizationPermission(gov, otherOrgId, "governance:read")).toBe(false);
    expect((await identity.resolveExperimentAccess(gov, experimentId))!.permissions).toEqual(expect.arrayContaining(["governance:read", "governance:manage"]));
    await pool.query(`DELETE FROM users WHERE id = $1`, [gov]);
  });
});
