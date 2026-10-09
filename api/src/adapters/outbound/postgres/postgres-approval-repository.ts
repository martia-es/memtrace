import type { Pool, PoolClient } from "pg";
import type { ApprovalRepository, NewApprovalRequest } from "@/application/ports/approval-repository";
import type { ApprovalAction, ApprovalDecision, ApprovalRequest, ApprovalRule, ApprovalScope, ApprovalStatus, ApproverInfo } from "@/domain/approval";

type Ts = Date | string;
const iso = (v: Ts): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RuleRow {
  action: ApprovalAction;
  stage: string;
  requirements: Array<{ role: string; min: number }>;
  approvers: string[];
}

const RULE_SELECT = `SELECT r.action, r.stage,
       COALESCE((SELECT json_agg(json_build_object('role', q.role, 'min', q.min_approvals) ORDER BY q.role) FROM approval_rule_requirements q WHERE q.rule_id = r.id), '[]'::json) AS requirements,
       COALESCE((SELECT array_agg(a.user_id::text ORDER BY a.user_id) FROM approval_rule_approvers a WHERE a.rule_id = r.id), '{}') AS approvers
  FROM approval_rules r`;

const toRule = (r: RuleRow): ApprovalRule => ({ action: r.action, stage: r.stage, requirements: r.requirements, approvers: r.approvers });

interface RequestRow {
  id: string;
  prompt_id: string;
  action: ApprovalAction;
  version: number;
  tag: string;
  note: string;
  bypass_reason: string | null;
  requested_by: string | null;
  status: ApprovalStatus;
  execution_error: string | null;
  created_at: Ts;
  expires_at: Ts;
  decided_at: Ts | null;
  executed_at: Ts | null;
  extra_approvers: string[];
  decisions: Array<{ userId: string; decision: "approve" | "reject"; comment: string; decidedAt: string }>;
}

const REQUEST_SELECT = `SELECT r.id, r.prompt_id, r.action, r.version, r.tag, r.note, r.bypass_reason, r.requested_by, r.status, r.execution_error,
       r.created_at, r.expires_at, r.decided_at, r.executed_at,
       COALESCE((SELECT array_agg(x.user_id::text ORDER BY x.added_at) FROM approval_request_approvers x WHERE x.request_id = r.id), '{}') AS extra_approvers,
       COALESCE((SELECT json_agg(json_build_object('userId', d.user_id, 'decision', d.decision, 'comment', d.comment, 'decidedAt', d.decided_at) ORDER BY d.decided_at) FROM approval_decisions d WHERE d.request_id = r.id), '[]'::json) AS decisions
  FROM approval_requests r`;

const toRequest = (r: RequestRow): ApprovalRequest => ({
  id: r.id,
  promptId: r.prompt_id,
  action: r.action,
  version: r.version,
  tag: r.tag,
  note: r.note,
  bypassReason: r.bypass_reason,
  requestedBy: r.requested_by,
  status: r.status,
  executionError: r.execution_error,
  createdAt: iso(r.created_at),
  expiresAt: iso(r.expires_at),
  decidedAt: r.decided_at === null ? null : iso(r.decided_at),
  executedAt: r.executed_at === null ? null : iso(r.executed_at),
  extraApprovers: r.extra_approvers,
  decisions: r.decisions.map((d): ApprovalDecision => ({ userId: d.userId, decision: d.decision, comment: d.comment, decidedAt: iso(d.decidedAt) })),
});

const scopeColumn = (scope: ApprovalScope): "organization_id" | "experiment_id" => (scope.type === "organization" ? "organization_id" : "experiment_id");

export class PostgresApprovalRepository implements ApprovalRepository {
  constructor(private readonly pool: Pool) {}

  private async tx<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await run(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listRules(scope: ApprovalScope): Promise<ApprovalRule[]> {
    if (!UUID.test(scope.id)) return [];
    const { rows } = await this.pool.query<RuleRow>(`${RULE_SELECT} WHERE r.${scopeColumn(scope)} = $1 ORDER BY r.action, r.stage`, [scope.id]);
    return rows.map(toRule);
  }

  async setRule(scope: ApprovalScope, rule: ApprovalRule, userId: string): Promise<ApprovalRule> {
    const column = scopeColumn(scope);
    await this.tx(async (client) => {
      const upsert = await client.query<{ id: string }>(
        `INSERT INTO approval_rules (${column}, action, stage, updated_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (${column}, action, stage) WHERE ${column} IS NOT NULL
         DO UPDATE SET updated_by = EXCLUDED.updated_by, updated_at = now() RETURNING id`,
        [scope.id, rule.action, rule.stage, userId],
      );
      const ruleId = upsert.rows[0]!.id;
      await client.query("DELETE FROM approval_rule_requirements WHERE rule_id = $1", [ruleId]);
      await client.query("DELETE FROM approval_rule_approvers WHERE rule_id = $1", [ruleId]);
      for (const req of rule.requirements) {
        await client.query("INSERT INTO approval_rule_requirements (rule_id, role, min_approvals) VALUES ($1, $2, $3)", [ruleId, req.role, req.min]);
      }
      for (const approver of rule.approvers) {
        await client.query("INSERT INTO approval_rule_approvers (rule_id, user_id) VALUES ($1, $2)", [ruleId, approver]);
      }
    });
    const { rows } = await this.pool.query<RuleRow>(`${RULE_SELECT} WHERE r.${column} = $1 AND r.action = $2 AND r.stage = $3`, [scope.id, rule.action, rule.stage]);
    return toRule(rows[0]!);
  }

  async deleteRule(scope: ApprovalScope, action: ApprovalAction, stage: string): Promise<boolean> {
    if (!UUID.test(scope.id)) return false;
    const result = await this.pool.query(`DELETE FROM approval_rules WHERE ${scopeColumn(scope)} = $1 AND action = $2 AND stage = $3`, [scope.id, action, stage]);
    return (result.rowCount ?? 0) > 0;
  }

  async rulesFor(organizationId: string, experimentIds: readonly string[], action: ApprovalAction, stage: string): Promise<ApprovalRule[]> {
    const experiments = experimentIds.filter((id) => UUID.test(id));
    const { rows } = await this.pool.query<RuleRow>(
      `${RULE_SELECT} WHERE (r.organization_id = $1 OR r.experiment_id = ANY($2::uuid[])) AND r.action = $3 AND r.stage = $4`,
      [organizationId, experiments, action, stage],
    );
    return rows.map(toRule);
  }

  async approvers(experimentIds: readonly string[]): Promise<ApproverInfo[]> {
    const experiments = experimentIds.filter((id) => UUID.test(id));
    if (experiments.length === 0) return [];
    const { rows } = await this.pool.query<{ user_id: string; roles: string[] }>(
      `SELECT m.user_id::text AS user_id, array_agg(DISTINCT m.role ORDER BY m.role) AS roles
         FROM experiment_memberships m
         JOIN role_permissions rp ON rp.role_name = m.role AND rp.permission = 'prompt:approve'
        WHERE m.experiment_id = ANY($1::uuid[])
        GROUP BY m.user_id`,
      [experiments],
    );
    return rows.map((r) => ({ userId: r.user_id, roles: r.roles }));
  }

  async approverCandidates(organizationId: string, experimentId?: string): Promise<Array<ApproverInfo & { email: string; name: string | null }>> {
    if (experimentId !== undefined && !UUID.test(experimentId)) return [];
    const { rows } = await this.pool.query<{ user_id: string; roles: string[]; email: string; name: string | null }>(
      `SELECT u.id::text AS user_id, array_agg(DISTINCT m.role ORDER BY m.role) AS roles, u.email, u.name
         FROM experiment_memberships m
         JOIN experiments e ON e.id = m.experiment_id AND e.organization_id = $1
         JOIN role_permissions rp ON rp.role_name = m.role AND rp.permission = 'prompt:approve'
         JOIN users u ON u.id = m.user_id
        WHERE ($2::uuid IS NULL OR m.experiment_id = $2::uuid)
        GROUP BY u.id, u.email, u.name
        ORDER BY u.email`,
      [organizationId, experimentId ?? null],
    );
    return rows.map((r) => ({ userId: r.user_id, roles: r.roles, email: r.email, name: r.name }));
  }

  async experimentRoleNames(): Promise<string[]> {
    const { rows } = await this.pool.query<{ name: string }>("SELECT name FROM roles WHERE scope = 'experiment' ORDER BY name");
    return rows.map((r) => r.name);
  }

  async createRequest(input: NewApprovalRequest): Promise<ApprovalRequest | null> {
    const id = await this.tx(async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO approval_requests (prompt_id, action, version, tag, note, bypass_reason, requested_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (prompt_id, action, version, tag) WHERE status IN ('pending', 'approved') DO NOTHING
         RETURNING id`,
        [input.promptId, input.action, input.version, input.tag, input.note, input.bypassReason, input.requestedBy, input.expiresAt],
      );
      const created = inserted.rows[0]?.id;
      if (!created) return null;
      for (const userId of input.extraApprovers) {
        await client.query("INSERT INTO approval_request_approvers (request_id, user_id, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [created, userId, input.requestedBy]);
      }
      return created;
    });
    return id === null ? null : this.getRequest(id);
  }

  async getRequest(requestId: string): Promise<ApprovalRequest | null> {
    if (!UUID.test(requestId)) return null;
    const { rows } = await this.pool.query<RequestRow>(`${REQUEST_SELECT} WHERE r.id = $1`, [requestId]);
    return rows[0] ? toRequest(rows[0]) : null;
  }

  async listRequests(promptId: string, limit: number): Promise<ApprovalRequest[]> {
    if (!UUID.test(promptId)) return [];
    const { rows } = await this.pool.query<RequestRow>(`${REQUEST_SELECT} WHERE r.prompt_id = $1 ORDER BY r.created_at DESC LIMIT $2`, [promptId, limit]);
    return rows.map(toRequest);
  }

  async listOpenForOrganization(organizationId: string): Promise<ApprovalRequest[]> {
    if (!UUID.test(organizationId)) return [];
    const { rows } = await this.pool.query<RequestRow>(
      `${REQUEST_SELECT} JOIN prompts p ON p.id = r.prompt_id WHERE p.organization_id = $1 AND r.status IN ('pending', 'approved') ORDER BY r.created_at DESC`,
      [organizationId],
    );
    return rows.map(toRequest);
  }

  async listAllForOrganization(organizationId: string, limit: number): Promise<ApprovalRequest[]> {
    if (!UUID.test(organizationId)) return [];
    const { rows } = await this.pool.query<RequestRow>(
      `${REQUEST_SELECT} JOIN prompts p ON p.id = r.prompt_id WHERE p.organization_id = $1 ORDER BY r.created_at DESC LIMIT $2`,
      [organizationId, limit],
    );
    return rows.map(toRequest);
  }

  async saveDecision(requestId: string, decision: Pick<ApprovalDecision, "userId" | "decision" | "comment">): Promise<void> {
    await this.pool.query(
      `INSERT INTO approval_decisions (request_id, user_id, decision, comment) VALUES ($1, $2, $3, $4)
       ON CONFLICT (request_id, user_id) DO UPDATE SET decision = EXCLUDED.decision, comment = EXCLUDED.comment, decided_at = now()`,
      [requestId, decision.userId, decision.decision, decision.comment],
    );
  }

  async addExtraApprover(requestId: string, userId: string, addedBy: string): Promise<void> {
    await this.pool.query("INSERT INTO approval_request_approvers (request_id, user_id, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [requestId, userId, addedBy]);
  }

  async claimExecution(requestId: string): Promise<boolean> {
    if (!UUID.test(requestId)) return false;
    const result = await this.pool.query(
      `UPDATE approval_requests SET claimed_at = now()
        WHERE id = $1 AND status IN ('pending', 'approved') AND (claimed_at IS NULL OR claimed_at < now() - interval '2 minutes')`,
      [requestId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async releaseExecution(requestId: string): Promise<void> {
    if (UUID.test(requestId)) await this.pool.query("UPDATE approval_requests SET claimed_at = NULL WHERE id = $1", [requestId]);
  }

  async setStatus(requestId: string, status: ApprovalStatus, patch: { executionError?: string | null } = {}): Promise<void> {
    await this.pool.query(
      `UPDATE approval_requests
          SET status = $2,
              execution_error = CASE WHEN $3::boolean THEN $4 ELSE execution_error END,
              decided_at = CASE WHEN $2 IN ('approved', 'rejected') AND decided_at IS NULL THEN now() ELSE decided_at END,
              executed_at = CASE WHEN $2 = 'executed' THEN now() ELSE executed_at END
        WHERE id = $1`,
      [requestId, status, patch.executionError !== undefined, patch.executionError ?? null],
    );
  }
}
