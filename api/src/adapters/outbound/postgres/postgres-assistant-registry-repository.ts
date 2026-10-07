import type { Pool, PoolClient } from "pg";
import type { AssistantRegistryRepository } from "@/application/ports/assistant-registry-repository";
import {
  applyProbe,
  classifyProbe,
  overallStatus,
  MEMBER_PREVIEW,
  RECENT_BUCKETS,
  type RecentHealth,
  type AccessGrant,
  type AssistantMember,
  type AssistantPerson,
  type AssistantCard,
  type AssistantPatch,
  type Connection,
  type ConnectionKind,
  type ConnectionStatus,
  type DeclaredConnection,
  type Deployment,
  type DeploymentPatch,
  type DeploymentSummary,
  type Environment,
  type GrantSource,
  type GrantSubjectType,
  type HealthCheck,
  type HealthStatus,
  type NewDeployment,
  type NewGrant,
  type ObservedConnection,
  type ProbeResult,
  type ProbeTarget,
  type RepoProvider,
} from "@/domain/assistant-registry";
import { AssistantInvariantError } from "@/domain/errors";

const UNIQUE_VIOLATION = "23505";
const FK_VIOLATION = "23503";
// un id con otra forma haría fallar el cast a uuid de Postgres (500): desde la API es simplemente "no existe"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ts = Date | string;
const iso = (v: Ts): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const isoOrNull = (v: Ts | null): string | null => (v === null ? null : iso(v));
const pgCode = (err: unknown): string | undefined => (typeof err === "object" && err !== null ? (err as { code?: string }).code : undefined);

interface DeploymentRow {
  id: string;
  experiment_id: string;
  environment_id: string;
  api_url: string;
  health_url: string | null;
  version: string | null;
  deploy_ref: string | null;
  auth_method: Deployment["authMethod"];
  auth_provider: string | null;
  auth_audience: string | null;
  health_check_enabled: boolean;
  health_interval_seconds: number | null;
  health_status: HealthStatus;
  health_checked_at: Ts | null;
  health_status_since: Ts | null;
  health_latency_ms: number | null;
  health_consecutive_failures: number;
}

const DEPLOYMENT_COLUMNS = `d.id, d.experiment_id, d.environment_id, d.api_url, d.health_url, d.version, d.deploy_ref, d.auth_method, d.auth_provider, d.auth_audience,
  d.health_check_enabled, d.health_interval_seconds, d.health_status, d.health_checked_at, d.health_status_since, d.health_latency_ms, d.health_consecutive_failures`;

function toDeployment(r: DeploymentRow): Deployment {
  return {
    id: r.id,
    experimentId: r.experiment_id,
    environmentId: r.environment_id,
    apiUrl: r.api_url,
    healthUrl: r.health_url,
    version: r.version,
    deployRef: r.deploy_ref,
    authMethod: r.auth_method,
    authProvider: r.auth_provider,
    authAudience: r.auth_audience,
    healthCheckEnabled: r.health_check_enabled,
    healthIntervalSeconds: r.health_interval_seconds,
    healthStatus: r.health_status,
    healthCheckedAt: isoOrNull(r.health_checked_at),
    healthStatusSince: isoOrNull(r.health_status_since),
    healthLatencyMs: r.health_latency_ms,
    healthConsecutiveFailures: r.health_consecutive_failures,
  };
}

interface ConnectionRow {
  id: string;
  experiment_id: string;
  kind: ConnectionKind;
  name: string;
  via: string | null;
  peer_experiment_id: string | null;
  declared: boolean;
  status: ConnectionStatus;
  first_seen_at: Ts | null;
  last_seen_at: Ts | null;
  decided_by: string | null;
  decided_at: Ts | null;
  note: string | null;
}
const CONNECTION_COLUMNS = `id, experiment_id, kind, name, via, peer_experiment_id, declared, status, first_seen_at, last_seen_at, decided_by, decided_at, note`;
const toConnection = (r: ConnectionRow): Connection => ({
  id: r.id,
  experimentId: r.experiment_id,
  kind: r.kind,
  name: r.name,
  via: r.via,
  peerExperimentId: r.peer_experiment_id,
  declared: r.declared,
  status: r.status,
  firstSeenAt: isoOrNull(r.first_seen_at),
  lastSeenAt: isoOrNull(r.last_seen_at),
  decidedBy: r.decided_by,
  decidedAt: isoOrNull(r.decided_at),
  note: r.note,
});

interface GrantRow {
  id: string;
  deployment_id: string;
  subject_type: GrantSubjectType;
  user_id: string | null;
  external_group: string | null;
  member_count: number | null;
  source: GrantSource;
  synced_at: Ts | null;
  user_name: string | null;
  user_email: string | null;
  user_image: string | null;
}
const GRANT_COLUMNS = `g.id, g.deployment_id, g.subject_type, g.user_id, g.external_group, g.member_count, g.source, g.synced_at,
       u.name AS user_name, u.email AS user_email, u.image AS user_image`;
const toGrant = (r: GrantRow): AccessGrant => ({
  id: r.id,
  deploymentId: r.deployment_id,
  subjectType: r.subject_type,
  userId: r.user_id,
  user: r.user_id && r.user_email ? { userId: r.user_id, name: r.user_name, email: r.user_email, image: r.user_image } : null,
  externalGroup: r.external_group,
  memberCount: r.member_count,
  source: r.source,
  syncedAt: isoOrNull(r.synced_at),
});

/** Columnas editables de un despliegue: clave del patch → columna. Solo las de esta lista llegan al SQL. */
const DEPLOYMENT_PATCH_COLUMNS: Record<keyof DeploymentPatch, string> = {
  apiUrl: "api_url",
  healthUrl: "health_url",
  version: "version",
  deployRef: "deploy_ref",
  authMethod: "auth_method",
  authProvider: "auth_provider",
  authAudience: "auth_audience",
  healthCheckEnabled: "health_check_enabled",
  healthIntervalSeconds: "health_interval_seconds",
};

export class PostgresAssistantRegistryRepository implements AssistantRegistryRepository {
  constructor(private readonly pool: Pool) {}

  async listEnvironments(organizationId: string): Promise<Environment[]> {
    const { rows } = await this.pool.query<{ id: string; organization_id: string; key: string; label: string; position: number; is_production: boolean; health_interval_seconds: number }>(
      `SELECT id, organization_id, key, label, position, is_production, health_interval_seconds FROM environments WHERE organization_id = $1 ORDER BY position, key`,
      [organizationId],
    );
    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      key: r.key,
      label: r.label,
      position: r.position,
      isProduction: r.is_production,
      healthIntervalSeconds: r.health_interval_seconds,
    }));
  }

  // ── Fichas ──────────────────────────────────────────────────────────────────────────────────────────────────

  async listCatalog(organizationId: string): Promise<AssistantCard[]> {
    return this.cards("e.organization_id = $1", [organizationId]);
  }

  async getCard(experimentId: string): Promise<AssistantCard | null> {
    if (!UUID.test(experimentId)) return null;
    return (await this.cards("e.id = $1", [experimentId]))[0] ?? null;
  }

  /** Una consulta por parte (fichas, despliegues, conexiones) en vez de un JOIN que multiplique filas. */
  private async cards(where: string, params: unknown[]): Promise<AssistantCard[]> {
    const { rows } = await this.pool.query<{
      experiment_id: string;
      description: string;
      owner_user_id: string | null;
      lifecycle: AssistantCard["lifecycle"];
      chat_path: string | null;
      chat_request_field: string;
      chat_response_field: string;
      chat_session_field: string | null;
      chat_trace_id_field: string | null;
      repo_url: string | null;
      repo_provider: RepoProvider | null;
      deploy_workflow: string | null;
      created_at: Ts;
      updated_at: Ts;
      name: string;
      service_name: string;
      owner_name: string | null;
      owner_email: string | null;
      owner_image: string | null;
    }>(
      `SELECT e.id AS experiment_id, e.description, e.owner_user_id, e.lifecycle, e.created_at, e.updated_at,
              e.chat_path, e.chat_request_field, e.chat_response_field, e.chat_session_field, e.chat_trace_id_field,
              e.repo_url, e.repo_provider, e.deploy_workflow,
              e.name, e.service_name, u.name AS owner_name, u.email AS owner_email, u.image AS owner_image
         FROM experiments e LEFT JOIN users u ON u.id = e.owner_user_id
        WHERE ${where} ORDER BY e.name`,
      params,
    );
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.experiment_id);

    const deploymentRows = await this.pool.query<
      DeploymentRow & { env_key: string; env_label: string; env_position: number; env_production: boolean; env_interval: number; everyone: boolean; groups: number; users: number }
    >(
      `SELECT ${DEPLOYMENT_COLUMNS},
              env.key AS env_key, env.label AS env_label, env.position AS env_position, env.is_production AS env_production, env.health_interval_seconds AS env_interval,
              EXISTS (SELECT 1 FROM deployment_access_grants g WHERE g.deployment_id = d.id AND g.subject_type = 'everyone') AS everyone,
              (SELECT count(*)::int FROM deployment_access_grants g WHERE g.deployment_id = d.id AND g.subject_type = 'group') AS groups,
              (SELECT count(*)::int FROM deployment_access_grants g WHERE g.deployment_id = d.id AND g.subject_type = 'user') AS users
         FROM assistant_deployments d JOIN environments env ON env.id = d.environment_id
        WHERE d.experiment_id = ANY($1::uuid[]) ORDER BY env.position, env.key`,
      [ids],
    );
    const deploymentIds = deploymentRows.rows.map((r) => r.id);
    const recent = await this.recentHealth(deploymentIds);
    const byExperiment = new Map<string, DeploymentSummary[]>();
    for (const r of deploymentRows.rows) {
      const list = byExperiment.get(r.experiment_id) ?? [];
      list.push({
        ...toDeployment(r),
        environment: { id: r.environment_id, key: r.env_key, label: r.env_label, position: r.env_position, isProduction: r.env_production, healthIntervalSeconds: r.env_interval },
        access: { everyone: r.everyone, groups: r.groups, users: r.users },
        recent: recent.get(r.id) ?? { buckets: Array<null>(RECENT_BUCKETS).fill(null), uptimePercent: null },
      });
      byExperiment.set(r.experiment_id, list);
    }

    const countRows = await this.pool.query<{ experiment_id: string; mcp: number; tools: number; agents: number; to_review: number; mcp_names: string[] | null }>(
      `SELECT experiment_id,
              count(*) FILTER (WHERE kind = 'mcp_server')::int AS mcp,
              count(*) FILTER (WHERE kind = 'tool')::int AS tools,
              count(*) FILTER (WHERE kind = 'agent')::int AS agents,
              count(*) FILTER (WHERE first_seen_at IS NOT NULL AND status = 'pending')::int AS to_review,
              array_agg(name ORDER BY name) FILTER (WHERE kind = 'mcp_server') AS mcp_names
         FROM assistant_connections WHERE experiment_id = ANY($1::uuid[]) GROUP BY experiment_id`,
      [ids],
    );
    const counts = new Map(countRows.rows.map((r) => [r.experiment_id, r]));
    const members = await this.membersOf(ids);

    return rows.map((r) => {
      const deployments = byExperiment.get(r.experiment_id) ?? [];
      const c = counts.get(r.experiment_id);
      return {
        experimentId: r.experiment_id,
        description: r.description,
        ownerUserId: r.owner_user_id,
        lifecycle: r.lifecycle,
        chat: r.chat_path
          ? { path: r.chat_path, requestField: r.chat_request_field, responseField: r.chat_response_field, sessionField: r.chat_session_field, traceIdField: r.chat_trace_id_field }
          : null,
        repo: r.repo_url && r.repo_provider ? { url: r.repo_url, provider: r.repo_provider, deployWorkflow: r.deploy_workflow } : null,
        createdAt: iso(r.created_at),
        updatedAt: iso(r.updated_at),
        name: r.name,
        serviceName: r.service_name,
        owner: r.owner_user_id ? { id: r.owner_user_id, name: r.owner_name, email: r.owner_email ?? "", image: r.owner_image } : null,
        deployments,
        connectionCounts: { mcpServers: c?.mcp ?? 0, tools: c?.tools ?? 0, agents: c?.agents ?? 0, toReview: c?.to_review ?? 0 },
        mcpServerNames: c?.mcp_names ?? [],
        members: members.get(r.experiment_id) ?? { total: 0, preview: [] },
        status: overallStatus(deployments),
      };
    });
  }

  /** Últimas 24 h de cada despliegue en `RECENT_BUCKETS` tramos, con el peor estado de cada uno, y el % de sondeos que no fueron `down`. */
  private async recentHealth(deploymentIds: string[]): Promise<Map<string, RecentHealth>> {
    const out = new Map<string, RecentHealth>();
    if (deploymentIds.length === 0) return out;
    const { rows } = await this.pool.query<{ deployment_id: string; bucket: number; severity: number; n: number; alive: number }>(
      `SELECT deployment_id,
              LEAST($2::int - 1, FLOOR(EXTRACT(EPOCH FROM (checked_at - (now() - interval '24 hours'))) / (86400.0 / $2::int)))::int AS bucket,
              MAX(CASE status WHEN 'down' THEN 3 WHEN 'degraded' THEN 2 WHEN 'unknown' THEN 1 ELSE 0 END)::int AS severity,
              COUNT(*)::int AS n, (COUNT(*) FILTER (WHERE status <> 'down'))::int AS alive
         FROM deployment_health_checks
        WHERE deployment_id = ANY($1::uuid[]) AND checked_at >= now() - interval '24 hours'
        GROUP BY 1, 2`,
      [deploymentIds, RECENT_BUCKETS],
    );
    const STATUS: HealthStatus[] = ["up", "unknown", "degraded", "down"];
    const totals = new Map<string, { n: number; alive: number }>();
    for (const r of rows) {
      let entry = out.get(r.deployment_id);
      if (!entry) {
        entry = { buckets: Array<HealthStatus | null>(RECENT_BUCKETS).fill(null), uptimePercent: null };
        out.set(r.deployment_id, entry);
      }
      entry.buckets[Math.max(0, r.bucket)] = STATUS[r.severity] ?? "unknown";
      const t = totals.get(r.deployment_id) ?? { n: 0, alive: 0 };
      totals.set(r.deployment_id, { n: t.n + r.n, alive: t.alive + r.alive });
    }
    for (const [id, t] of totals) out.get(id)!.uptimePercent = t.n > 0 ? (t.alive / t.n) * 100 : null;
    return out;
  }

  /** Quién participa en cada experimento: técnicos primero y luego el resto, con las primeras `MEMBER_PREVIEW` personas y el total. */
  private async membersOf(experimentIds: string[]): Promise<Map<string, { total: number; preview: AssistantMember[] }>> {
    const out = new Map<string, { total: number; preview: AssistantMember[] }>();
    const { rows } = await this.pool.query<{ experiment_id: string; user_id: string; name: string | null; email: string; image: string | null; role: string; total: number }>(
      `SELECT m.experiment_id, m.user_id, u.name, u.email, u.image, m.role,
              (COUNT(*) OVER (PARTITION BY m.experiment_id))::int AS total
         FROM experiment_memberships m JOIN users u ON u.id = m.user_id
        WHERE m.experiment_id = ANY($1::uuid[])
        ORDER BY m.experiment_id, (m.role = 'technical') DESC, m.created_at, u.email`,
      [experimentIds],
    );
    for (const r of rows) {
      const entry = out.get(r.experiment_id) ?? { total: r.total, preview: [] };
      if (entry.preview.length < MEMBER_PREVIEW) entry.preview.push({ userId: r.user_id, name: r.name, email: r.email, image: r.image, role: r.role });
      out.set(r.experiment_id, entry);
    }
    return out;
  }

  async update(experimentId: string, patch: AssistantPatch): Promise<AssistantCard | null> {
    if (!UUID.test(experimentId)) return null;
    const sets: string[] = [];
    const values: unknown[] = [experimentId];
    const add = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (patch.description !== undefined) add("description", patch.description);
    if (patch.ownerUserId !== undefined) add("owner_user_id", patch.ownerUserId);
    if (patch.lifecycle !== undefined) add("lifecycle", patch.lifecycle);
    if (patch.chat !== undefined) {
      // quitar el endpoint deja los campos en su valor por defecto
      add("chat_path", patch.chat?.path ?? null);
      add("chat_request_field", patch.chat?.requestField ?? "message");
      add("chat_response_field", patch.chat?.responseField ?? "reply");
      add("chat_session_field", patch.chat?.sessionField ?? null);
      add("chat_trace_id_field", patch.chat?.traceIdField ?? null);
    }
    if (patch.repo !== undefined) {
      add("repo_url", patch.repo?.url ?? null);
      add("repo_provider", patch.repo?.provider ?? null);
      add("deploy_workflow", patch.repo?.deployWorkflow ?? null);
    }
    const { rowCount } = await this.pool.query(`UPDATE experiments SET ${[...sets, "updated_at = now()"].join(", ")} WHERE id = $1`, values);
    return rowCount ? this.getCard(experimentId) : null;
  }

  // ── Despliegues ─────────────────────────────────────────────────────────────────────────────────────────────

  async createDeployment(experimentId: string, input: NewDeployment): Promise<Deployment> {
    try {
      // el entorno se resuelve por la organización del experimento: así nunca se usa un entorno de otra organización
      const { rows } = await this.pool.query<{ id: string }>(
        `INSERT INTO assistant_deployments (experiment_id, environment_id, api_url, health_url, version, auth_method, auth_provider, auth_audience, health_check_enabled, health_interval_seconds, deploy_ref)
         SELECT $1, env.id, $3, $4, $5, $6, $7, $8, $9, $10, $11
           FROM experiments e JOIN environments env ON env.organization_id = e.organization_id
          WHERE e.id = $1 AND env.key = $2
         RETURNING id`,
        [experimentId, input.environmentKey, input.apiUrl, input.healthUrl, input.version, input.authMethod, input.authProvider, input.authAudience, input.healthCheckEnabled, input.healthIntervalSeconds, input.deployRef],
      );
      const id = rows[0]?.id;
      if (!id) throw new AssistantInvariantError(`Unknown environment "${input.environmentKey}" in this organization`);
      return (await this.getDeployment(experimentId, id))!;
    } catch (err) {
      if (pgCode(err) === UNIQUE_VIOLATION) throw new AssistantInvariantError(`This assistant already has a deployment in "${input.environmentKey}"`);
      throw err;
    }
  }

  async getDeployment(experimentId: string, deploymentId: string): Promise<Deployment | null> {
    if (!UUID.test(experimentId) || !UUID.test(deploymentId)) return null;
    const { rows } = await this.pool.query<DeploymentRow>(`SELECT ${DEPLOYMENT_COLUMNS} FROM assistant_deployments d WHERE d.experiment_id = $1 AND d.id = $2`, [experimentId, deploymentId]);
    return rows[0] ? toDeployment(rows[0]) : null;
  }

  async updateDeployment(experimentId: string, deploymentId: string, patch: DeploymentPatch): Promise<Deployment | null> {
    if (!UUID.test(experimentId) || !UUID.test(deploymentId)) return null;
    const sets: string[] = [];
    const values: unknown[] = [experimentId, deploymentId];
    for (const [key, column] of Object.entries(DEPLOYMENT_PATCH_COLUMNS) as Array<[keyof DeploymentPatch, string]>) {
      if (patch[key] === undefined) continue;
      values.push(patch[key]);
      sets.push(`${column} = $${values.length}`);
    }
    const { rowCount } = await this.pool.query(`UPDATE assistant_deployments SET ${[...sets, "updated_at = now()"].join(", ")} WHERE experiment_id = $1 AND id = $2`, values);
    return rowCount ? this.getDeployment(experimentId, deploymentId) : null;
  }

  async deleteDeployment(experimentId: string, deploymentId: string): Promise<boolean> {
    if (!UUID.test(experimentId) || !UUID.test(deploymentId)) return false;
    const { rowCount } = await this.pool.query(`DELETE FROM assistant_deployments WHERE experiment_id = $1 AND id = $2`, [experimentId, deploymentId]);
    return (rowCount ?? 0) > 0;
  }

  // ── Salud ───────────────────────────────────────────────────────────────────────────────────────────────────

  async listHealthChecks(experimentId: string, deploymentId: string, since: Date, limit: number): Promise<HealthCheck[] | null> {
    if (!(await this.getDeployment(experimentId, deploymentId))) return null;
    const { rows } = await this.pool.query<{ checked_at: Ts; status: HealthStatus; latency_ms: number | null; http_status: number | null; error: string | null }>(
      `SELECT checked_at, status, latency_ms, http_status, error FROM deployment_health_checks
        WHERE deployment_id = $1 AND checked_at >= $2 ORDER BY checked_at DESC LIMIT $3`,
      [deploymentId, since, limit],
    );
    return rows.map((r) => ({ deploymentId, checkedAt: iso(r.checked_at), status: r.status, latencyMs: r.latency_ms, httpStatus: r.http_status, error: r.error }));
  }

  async listDueDeployments(now: Date, limit: number): Promise<ProbeTarget[]> {
    const { rows } = await this.pool.query<{ id: string; url: string; health_status: HealthStatus; health_status_since: Ts | null; health_consecutive_failures: number }>(
      `SELECT d.id, COALESCE(d.health_url, regexp_replace(d.api_url, '/+$', '') || '/health') AS url,
              d.health_status, d.health_status_since, d.health_consecutive_failures
         FROM assistant_deployments d
         JOIN environments env ON env.id = d.environment_id
         JOIN experiments x ON x.id = d.experiment_id
        WHERE d.health_check_enabled AND x.lifecycle = 'active'
          AND (d.health_checked_at IS NULL
               OR d.health_checked_at + make_interval(secs => GREATEST(COALESCE(d.health_interval_seconds, env.health_interval_seconds), 15)) <= $1)
        ORDER BY d.health_checked_at NULLS FIRST LIMIT $2`,
      [now, limit],
    );
    return rows.map((r) => ({
      deploymentId: r.id,
      url: r.url,
      status: r.health_status,
      statusSince: isoOrNull(r.health_status_since),
      consecutiveFailures: r.health_consecutive_failures,
    }));
  }

  async recordProbe(deploymentId: string, result: ProbeResult, checkedAt: Date): Promise<{ previous: HealthStatus; current: HealthStatus } | null> {
    if (!UUID.test(deploymentId)) return null;
    return this.inTransaction(async (client) => {
      const { rows } = await client.query<{ health_status: HealthStatus; health_status_since: Ts | null; health_consecutive_failures: number }>(
        `SELECT health_status, health_status_since, health_consecutive_failures FROM assistant_deployments WHERE id = $1 FOR UPDATE`,
        [deploymentId],
      );
      const row = rows[0];
      if (!row) return null;
      const probed = classifyProbe(result);
      const next = applyProbe({ status: row.health_status, statusSince: isoOrNull(row.health_status_since), consecutiveFailures: row.health_consecutive_failures }, probed, checkedAt.toISOString());
      await client.query(
        `INSERT INTO deployment_health_checks (deployment_id, checked_at, status, latency_ms, http_status, error) VALUES ($1, $2, $3, $4, $5, $6)`,
        [deploymentId, checkedAt, probed, result.latencyMs, result.httpStatus, result.error],
      );
      await client.query(
        `UPDATE assistant_deployments
            SET health_status = $2, health_status_since = $3, health_consecutive_failures = $4, health_checked_at = $5, health_latency_ms = $6
          WHERE id = $1`,
        [deploymentId, next.status, next.statusSince, next.consecutiveFailures, checkedAt, result.latencyMs],
      );
      return { previous: row.health_status, current: next.status };
    });
  }

  async pruneHealthChecks(before: Date): Promise<number> {
    const { rowCount } = await this.pool.query(`DELETE FROM deployment_health_checks WHERE checked_at < $1`, [before]);
    return rowCount ?? 0;
  }

  // ── Conexiones ──────────────────────────────────────────────────────────────────────────────────────────────

  async listActiveExperiments(): Promise<Array<{ experimentId: string; serviceName: string }>> {
    const { rows } = await this.pool.query<{ id: string; service_name: string }>(`SELECT id, service_name FROM experiments WHERE lifecycle = 'active' ORDER BY created_at`);
    return rows.map((r) => ({ experimentId: r.id, serviceName: r.service_name }));
  }

  async listConnections(experimentId: string): Promise<Connection[]> {
    if (!UUID.test(experimentId)) return [];
    const { rows } = await this.pool.query<ConnectionRow>(`SELECT ${CONNECTION_COLUMNS} FROM assistant_connections WHERE experiment_id = $1 ORDER BY kind, name`, [experimentId]);
    return rows.map(toConnection);
  }

  async declareConnection(experimentId: string, input: DeclaredConnection): Promise<Connection> {
    if (input.peerExperimentId) {
      // el agente con el que habla debe ser otro experimento de la misma organización (ADR-054)
      const { rows } = await this.pool.query(
        `SELECT 1 FROM experiments a JOIN experiments b ON b.organization_id = a.organization_id WHERE a.id = $1 AND b.id = $2`,
        [experimentId, input.peerExperimentId],
      );
      if (rows.length === 0) throw new AssistantInvariantError("The agent it points to must be an experiment of the same organization");
    }
    try {
      const { rows } = await this.pool.query<ConnectionRow>(
        `INSERT INTO assistant_connections (experiment_id, kind, name, via, peer_experiment_id, declared) VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (experiment_id, kind, name) DO UPDATE
            SET declared = true,
                via = COALESCE(EXCLUDED.via, assistant_connections.via),
                peer_experiment_id = COALESCE(EXCLUDED.peer_experiment_id, assistant_connections.peer_experiment_id),
                updated_at = now()
         RETURNING ${CONNECTION_COLUMNS}`,
        [experimentId, input.kind, input.name.trim(), input.via ?? null, input.peerExperimentId ?? null],
      );
      return toConnection(rows[0]!);
    } catch (err) {
      if (pgCode(err) === FK_VIOLATION) throw new AssistantInvariantError("The agent it points to does not exist");
      throw err;
    }
  }

  async undeclareConnection(experimentId: string, connectionId: string): Promise<boolean> {
    if (!UUID.test(experimentId) || !UUID.test(connectionId)) return false;
    const removed = await this.pool.query(`DELETE FROM assistant_connections WHERE experiment_id = $1 AND id = $2 AND first_seen_at IS NULL`, [experimentId, connectionId]);
    if (removed.rowCount) return true;
    const kept = await this.pool.query(`UPDATE assistant_connections SET declared = false, updated_at = now() WHERE experiment_id = $1 AND id = $2`, [experimentId, connectionId]);
    return (kept.rowCount ?? 0) > 0;
  }

  async decideConnection(experimentId: string, connectionId: string, status: ConnectionStatus, decidedBy: string, note: string | null): Promise<Connection | null> {
    if (!UUID.test(experimentId) || !UUID.test(connectionId)) return null;
    const { rows } = await this.pool.query<ConnectionRow>(
      `UPDATE assistant_connections SET status = $3, decided_by = $4, decided_at = now(), note = $5, updated_at = now()
        WHERE experiment_id = $1 AND id = $2 RETURNING ${CONNECTION_COLUMNS}`,
      [experimentId, connectionId, status, decidedBy, note],
    );
    return rows[0] ? toConnection(rows[0]) : null;
  }

  async recordObservedConnections(experimentId: string, observed: ObservedConnection[], seenAt: Date): Promise<void> {
    if (observed.length === 0) return;
    await this.inTransaction(async (client) => {
      for (const o of observed) {
        await client.query(
          `INSERT INTO assistant_connections (experiment_id, kind, name, via, first_seen_at, last_seen_at) VALUES ($1, $2, $3, $4, $5, $5)
           ON CONFLICT (experiment_id, kind, name) DO UPDATE
              SET first_seen_at = COALESCE(assistant_connections.first_seen_at, EXCLUDED.first_seen_at),
                  last_seen_at = GREATEST(COALESCE(assistant_connections.last_seen_at, EXCLUDED.last_seen_at), EXCLUDED.last_seen_at),
                  via = COALESCE(assistant_connections.via, EXCLUDED.via),
                  updated_at = now()`,
          [experimentId, o.kind, o.name, o.via ?? null, seenAt],
        );
      }
    });
  }

  // ── Accesos ─────────────────────────────────────────────────────────────────────────────────────────────────

  async listGrants(experimentId: string, deploymentId: string): Promise<AccessGrant[] | null> {
    if (!(await this.getDeployment(experimentId, deploymentId))) return null;
    const { rows } = await this.pool.query<GrantRow>(
      `SELECT ${GRANT_COLUMNS}
         FROM deployment_access_grants g LEFT JOIN users u ON u.id = g.user_id
        WHERE g.deployment_id = $1 ORDER BY g.subject_type, g.external_group, g.created_at`,
      [deploymentId],
    );
    return rows.map(toGrant);
  }

  async searchPeople(experimentId: string, query: string, limit: number): Promise<AssistantPerson[] | null> {
    if (!UUID.test(experimentId)) return null;
    const like = `%${query.trim().replace(/[\\%_]/g, "\\$&")}%`;
    const { rows } = await this.pool.query<{ id: string; name: string | null; email: string; image: string | null }>(
      `SELECT u.id, u.name, u.email, u.image
         FROM users u
        WHERE (u.name ILIKE $2 OR u.email ILIKE $2)
          AND (EXISTS (SELECT 1 FROM org_memberships om JOIN experiments e ON e.organization_id = om.organization_id WHERE e.id = $1 AND om.user_id = u.id)
            OR EXISTS (SELECT 1 FROM experiment_memberships xm WHERE xm.experiment_id = $1 AND xm.user_id = u.id))
        ORDER BY u.name NULLS LAST, u.email
        LIMIT $3`,
      [experimentId, like, limit],
    );
    return rows.map((r) => ({ userId: r.id, name: r.name, email: r.email, image: r.image }));
  }

  async addGrant(experimentId: string, deploymentId: string, grant: NewGrant, createdBy: string): Promise<AccessGrant | null> {
    if (!(await this.getDeployment(experimentId, deploymentId))) return null;
    try {
      const { rows } = await this.pool.query<GrantRow>(
        `WITH g AS (
           INSERT INTO deployment_access_grants (deployment_id, subject_type, user_id, external_group, member_count, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *
         )
         SELECT ${GRANT_COLUMNS} FROM g LEFT JOIN users u ON u.id = g.user_id`,
        [deploymentId, grant.subjectType, grant.userId ?? null, grant.externalGroup?.trim() || null, grant.memberCount ?? null, createdBy],
      );
      return toGrant(rows[0]!);
    } catch (err) {
      if (pgCode(err) === UNIQUE_VIOLATION) throw new AssistantInvariantError("That access already exists for this environment");
      if (pgCode(err) === FK_VIOLATION) throw new AssistantInvariantError("Unknown user");
      throw err;
    }
  }

  async removeGrant(experimentId: string, deploymentId: string, grantId: string): Promise<boolean> {
    if (!UUID.test(grantId) || !(await this.getDeployment(experimentId, deploymentId))) return false;
    const { rowCount } = await this.pool.query(`DELETE FROM deployment_access_grants WHERE deployment_id = $1 AND id = $2`, [deploymentId, grantId]);
    return (rowCount ?? 0) > 0;
  }

  private async inTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await run(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
