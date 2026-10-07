import type { Pool } from "pg";
import type { DeployRunRepository } from "@/application/ports/deploy-run-repository";
import type { DeployRun, DeployStatus, NewDeployRun } from "@/domain/deploy";

type Ts = Date | string;
const iso = (v: Ts): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

interface Row {
  id: string;
  deployment_id: string;
  experiment_id: string;
  commit_sha: string;
  ref: string;
  requested_by: string | null;
  status: DeployStatus;
  gate_verdict: string;
  gate_bypassed: boolean;
  bypass_reason: string | null;
  provider_run_url: string | null;
  error: string | null;
  created_at: Ts;
  finished_at: Ts | null;
}

const COLUMNS = "id, deployment_id, experiment_id, commit_sha, ref, requested_by, status, gate_verdict, gate_bypassed, bypass_reason, provider_run_url, error, created_at, finished_at";

const toRun = (r: Row): DeployRun => ({
  id: r.id,
  deploymentId: r.deployment_id,
  experimentId: r.experiment_id,
  commitSha: r.commit_sha,
  ref: r.ref,
  requestedBy: r.requested_by,
  status: r.status,
  gateVerdict: r.gate_verdict,
  gateBypassed: r.gate_bypassed,
  bypassReason: r.bypass_reason,
  providerRunUrl: r.provider_run_url,
  error: r.error,
  createdAt: iso(r.created_at),
  finishedAt: r.finished_at === null ? null : iso(r.finished_at),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PostgresDeployRunRepository implements DeployRunRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: NewDeployRun): Promise<DeployRun> {
    const { rows } = await this.pool.query<Row>(
      `INSERT INTO deploy_runs (deployment_id, experiment_id, commit_sha, ref, requested_by, gate_verdict, gate_bypassed, bypass_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLUMNS}`,
      [input.deploymentId, input.experimentId, input.commitSha, input.ref, input.requestedBy, input.gateVerdict, input.gateBypassed, input.bypassReason],
    );
    return toRun(rows[0]!);
  }

  async get(id: string): Promise<DeployRun | null> {
    if (!UUID.test(id)) return null;
    const { rows } = await this.pool.query<Row>(`SELECT ${COLUMNS} FROM deploy_runs WHERE id = $1`, [id]);
    return rows[0] ? toRun(rows[0]) : null;
  }

  async hasActive(deploymentId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM deploy_runs WHERE deployment_id = $1 AND status IN ('queued', 'running') AND created_at > now() - interval '1 hour' LIMIT 1`,
      [deploymentId],
    );
    return rows.length > 0;
  }

  async listForDeployment(deploymentId: string, limit: number): Promise<DeployRun[]> {
    const { rows } = await this.pool.query<Row>(`SELECT ${COLUMNS} FROM deploy_runs WHERE deployment_id = $1 ORDER BY created_at DESC LIMIT $2`, [deploymentId, limit]);
    return rows.map(toRun);
  }

  async setStatus(id: string, status: DeployStatus, patch: { providerRunUrl?: string | null; error?: string | null } = {}): Promise<DeployRun | null> {
    if (!UUID.test(id)) return null;
    const final = status === "succeeded" || status === "failed" || status === "cancelled";
    const { rows } = await this.pool.query<Row>(
      `UPDATE deploy_runs
          SET status = $2,
              provider_run_url = COALESCE($3, provider_run_url),
              error = COALESCE($4, error),
              finished_at = CASE WHEN $5 THEN now() ELSE finished_at END
        WHERE id = $1 AND status NOT IN ('succeeded', 'failed', 'cancelled')
        RETURNING ${COLUMNS}`,
      [id, status, patch.providerRunUrl ?? null, patch.error ?? null, final],
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  async succeededShas(experimentId: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ commit_sha: string }>(`SELECT DISTINCT commit_sha FROM deploy_runs WHERE experiment_id = $1 AND status = 'succeeded'`, [experimentId]);
    return rows.map((r) => r.commit_sha);
  }
}
