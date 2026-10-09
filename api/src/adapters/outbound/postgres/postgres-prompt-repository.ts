import type { Pool, PoolClient } from "pg";
import type { PromptRepository } from "@/application/ports/prompt-repository";
import { PromptInvariantError } from "@/domain/errors";
import type { GateRecord, NewPrompt, NewPromptVersion, Prompt, PromptSummary, PromptTag, PromptTagEvent, PromptUsage, PromptVersion, UsageItem } from "@/domain/prompt";
import type { PromptPolicy } from "@/domain/prompt-gate";

type Ts = Date | string;
const iso = (v: Ts): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const UNIQUE_VIOLATION = "23505";
// un id con otra forma haría fallar el cast a uuid de Postgres (500): desde la API es simplemente "no existe"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PromptRow {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  archived_at: Ts | null;
  created_by: string | null;
  created_at: Ts;
  updated_at: Ts;
  experiment_ids: string[] | null;
}

interface VersionRow {
  id: string;
  prompt_id: string;
  version: number;
  content: string;
  variables: string[];
  content_hash: string;
  parent_version: number | null;
  message: string;
  created_by: string | null;
  created_at: Ts;
}

const PROMPT_SELECT = `SELECT p.id, p.organization_id, p.name, p.description, p.archived_at, p.created_by, p.created_at, p.updated_at,
       COALESCE((SELECT array_agg(pa.experiment_id::text ORDER BY pa.linked_at) FROM prompt_agents pa WHERE pa.prompt_id = p.id), '{}') AS experiment_ids
  FROM prompts p`;

const VERSION_COLUMNS = "id, prompt_id, version, content, variables, content_hash, parent_version, message, created_by, created_at";

const toPrompt = (r: PromptRow): Prompt => ({
  id: r.id,
  organizationId: r.organization_id,
  name: r.name,
  description: r.description,
  archivedAt: r.archived_at === null ? null : iso(r.archived_at),
  createdBy: r.created_by,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
  experimentIds: r.experiment_ids ?? [],
});

const toVersion = (r: VersionRow): PromptVersion => ({
  id: r.id,
  promptId: r.prompt_id,
  version: r.version,
  content: r.content,
  variables: r.variables,
  contentHash: r.content_hash,
  parentVersion: r.parent_version,
  message: r.message,
  createdBy: r.created_by,
  createdAt: iso(r.created_at),
});

export class PostgresPromptRepository implements PromptRepository {
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

  async environmentKeys(organizationId: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ key: string }>("SELECT key FROM environments WHERE organization_id = $1 ORDER BY position", [organizationId]);
    return rows.map((r) => r.key);
  }

  async experimentsInOrganization(organizationId: string, experimentIds: string[]): Promise<string[]> {
    const valid = experimentIds.filter((id) => UUID.test(id));
    if (valid.length === 0) return [];
    const { rows } = await this.pool.query<{ id: string }>("SELECT id FROM experiments WHERE organization_id = $1 AND id = ANY($2::uuid[])", [organizationId, valid]);
    return rows.map((r) => r.id);
  }

  async create(input: NewPrompt, firstVersion: Omit<NewPromptVersion, "promptId">): Promise<{ prompt: Prompt; version: PromptVersion }> {
    try {
      return await this.tx(async (client) => {
        const created = await client.query<{ id: string }>(
          "INSERT INTO prompts (organization_id, name, description, created_by) VALUES ($1, $2, $3, $4) RETURNING id",
          [input.organizationId, input.name, input.description, input.createdBy],
        );
        const promptId = created.rows[0]!.id;
        for (const experimentId of input.experimentIds) {
          await client.query("INSERT INTO prompt_agents (prompt_id, experiment_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [promptId, experimentId]);
        }
        const version = await this.insertVersion(client, { ...firstVersion, promptId });
        const { rows } = await client.query<PromptRow>(`${PROMPT_SELECT} WHERE p.id = $1`, [promptId]);
        return { prompt: toPrompt(rows[0]!), version };
      });
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) throw new PromptInvariantError(`A prompt named "${input.name}" already exists in this organization`);
      throw error;
    }
  }

  async get(promptId: string): Promise<Prompt | null> {
    if (!UUID.test(promptId)) return null;
    const { rows } = await this.pool.query<PromptRow>(`${PROMPT_SELECT} WHERE p.id = $1`, [promptId]);
    return rows[0] ? toPrompt(rows[0]) : null;
  }

  async findByName(organizationId: string, name: string): Promise<Prompt | null> {
    const { rows } = await this.pool.query<PromptRow>(`${PROMPT_SELECT} WHERE p.organization_id = $1 AND p.name = $2`, [organizationId, name]);
    return rows[0] ? toPrompt(rows[0]) : null;
  }

  async list(organizationId: string, filter: { experimentId?: string; includeArchived?: boolean }): Promise<PromptSummary[]> {
    const params: unknown[] = [organizationId];
    let where = "WHERE p.organization_id = $1";
    if (!filter.includeArchived) where += " AND p.archived_at IS NULL";
    if (filter.experimentId) {
      params.push(filter.experimentId);
      where += ` AND EXISTS (SELECT 1 FROM prompt_agents x WHERE x.prompt_id = p.id AND x.experiment_id = $${params.length})`;
    }
    const { rows } = await this.pool.query<PromptRow & { latest_version: number | null }>(
      `SELECT p.id, p.organization_id, p.name, p.description, p.archived_at, p.created_by, p.created_at, p.updated_at,
              COALESCE((SELECT array_agg(pa.experiment_id::text ORDER BY pa.linked_at) FROM prompt_agents pa WHERE pa.prompt_id = p.id), '{}') AS experiment_ids,
              (SELECT MAX(v.version) FROM prompt_versions v WHERE v.prompt_id = p.id) AS latest_version
         FROM prompts p ${where} ORDER BY p.name`,
      params,
    );
    if (rows.length === 0) return [];
    const tagRows = await this.pool.query<{ prompt_id: string; tag: string; version: number }>(
      `SELECT t.prompt_id, t.tag, v.version FROM prompt_tags t JOIN prompt_versions v ON v.id = t.version_id WHERE t.prompt_id = ANY($1::uuid[])`,
      [rows.map((r) => r.id)],
    );
    const tagsByPrompt = new Map<string, Record<string, number>>();
    for (const t of tagRows.rows) tagsByPrompt.set(t.prompt_id, { ...(tagsByPrompt.get(t.prompt_id) ?? {}), [t.tag]: t.version });
    return rows.map((r) => ({ ...toPrompt(r), latestVersion: r.latest_version ?? 0, tags: tagsByPrompt.get(r.id) ?? {} }));
  }

  async update(promptId: string, patch: { description?: string; archived?: boolean }): Promise<Prompt | null> {
    if (!UUID.test(promptId)) return null;
    const { rowCount } = await this.pool.query(
      `UPDATE prompts
          SET description = COALESCE($2, description),
              archived_at = CASE WHEN $3::boolean IS NULL THEN archived_at WHEN $3 THEN COALESCE(archived_at, now()) ELSE NULL END,
              updated_at = now()
        WHERE id = $1`,
      [promptId, patch.description ?? null, patch.archived ?? null],
    );
    return rowCount ? this.get(promptId) : null;
  }

  async setAgents(promptId: string, experimentIds: string[]): Promise<void> {
    await this.tx(async (client) => {
      await client.query("DELETE FROM prompt_agents WHERE prompt_id = $1 AND NOT (experiment_id = ANY($2::uuid[]))", [promptId, experimentIds]);
      for (const experimentId of experimentIds) {
        await client.query("INSERT INTO prompt_agents (prompt_id, experiment_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [promptId, experimentId]);
      }
      await client.query("UPDATE prompts SET updated_at = now() WHERE id = $1", [promptId]);
    });
  }

  private async insertVersion(client: PoolClient, input: NewPromptVersion): Promise<PromptVersion> {
    // el bloqueo del prompt serializa a dos guardados simultáneos: cada uno recibe el número siguiente
    await client.query("SELECT id FROM prompts WHERE id = $1 FOR UPDATE", [input.promptId]);
    const { rows } = await client.query<VersionRow>(
      `INSERT INTO prompt_versions (prompt_id, version, content, variables, content_hash, parent_version, message, created_by)
       VALUES ($1, COALESCE((SELECT MAX(version) FROM prompt_versions WHERE prompt_id = $1), 0) + 1, $2, $3, $4, $5, $6, $7)
       RETURNING ${VERSION_COLUMNS}`,
      [input.promptId, input.content, input.variables, input.contentHash, input.parentVersion, input.message, input.createdBy],
    );
    await client.query("UPDATE prompts SET updated_at = now() WHERE id = $1", [input.promptId]);
    return toVersion(rows[0]!);
  }

  async addVersion(input: NewPromptVersion): Promise<PromptVersion> {
    return this.tx((client) => this.insertVersion(client, input));
  }

  async listVersions(promptId: string): Promise<PromptVersion[]> {
    if (!UUID.test(promptId)) return [];
    const { rows } = await this.pool.query<VersionRow>(`SELECT ${VERSION_COLUMNS} FROM prompt_versions WHERE prompt_id = $1 ORDER BY version DESC`, [promptId]);
    return rows.map(toVersion);
  }

  async getVersion(promptId: string, version: number): Promise<PromptVersion | null> {
    if (!UUID.test(promptId)) return null;
    const { rows } = await this.pool.query<VersionRow>(`SELECT ${VERSION_COLUMNS} FROM prompt_versions WHERE prompt_id = $1 AND version = $2`, [promptId, version]);
    return rows[0] ? toVersion(rows[0]) : null;
  }

  async getVersionByTag(promptId: string, tag: string): Promise<PromptVersion | null> {
    if (!UUID.test(promptId)) return null;
    const { rows } = await this.pool.query<VersionRow>(
      `SELECT ${VERSION_COLUMNS.split(", ").map((c) => `v.${c}`).join(", ")}
         FROM prompt_tags t JOIN prompt_versions v ON v.id = t.version_id WHERE t.prompt_id = $1 AND t.tag = $2`,
      [promptId, tag],
    );
    return rows[0] ? toVersion(rows[0]) : null;
  }

  async listTags(promptId: string): Promise<PromptTag[]> {
    if (!UUID.test(promptId)) return [];
    const { rows } = await this.pool.query<{ tag: string; version: number; updated_by: string | null; updated_at: Ts }>(
      `SELECT t.tag, v.version, t.updated_by, t.updated_at FROM prompt_tags t JOIN prompt_versions v ON v.id = t.version_id WHERE t.prompt_id = $1 ORDER BY t.tag`,
      [promptId],
    );
    return rows.map((r) => ({ tag: r.tag, version: r.version, updatedBy: r.updated_by, updatedAt: iso(r.updated_at) }));
  }

  async moveTag(promptId: string, tag: string, version: number | null, userId: string, reason: string, gate: GateRecord): Promise<PromptTagEvent | null> {
    return this.tx(async (client) => {
      await client.query("SELECT id FROM prompts WHERE id = $1 FOR UPDATE", [promptId]);
      let target: { id: string } | undefined;
      if (version !== null) {
        const found = await client.query<{ id: string }>("SELECT id FROM prompt_versions WHERE prompt_id = $1 AND version = $2", [promptId, version]);
        target = found.rows[0];
        if (!target) return null;
      }
      const previous = await client.query<{ version: number }>(
        "SELECT v.version FROM prompt_tags t JOIN prompt_versions v ON v.id = t.version_id WHERE t.prompt_id = $1 AND t.tag = $2",
        [promptId, tag],
      );
      const from = previous.rows[0]?.version ?? null;
      if (target) {
        await client.query(
          `INSERT INTO prompt_tags (prompt_id, tag, version_id, updated_by) VALUES ($1, $2, $3, $4)
           ON CONFLICT (prompt_id, tag) DO UPDATE SET version_id = EXCLUDED.version_id, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [promptId, tag, target.id, userId],
        );
      } else {
        await client.query("DELETE FROM prompt_tags WHERE prompt_id = $1 AND tag = $2", [promptId, tag]);
      }
      const event = await client.query<{ id: string; created_at: Ts }>(
        `INSERT INTO prompt_tag_events (prompt_id, tag, from_version, to_version, changed_by, reason, gate_verdict, gate_bypassed, bypass_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, created_at`,
        [promptId, tag, from, version, userId, reason, gate.verdict, gate.bypassed, gate.bypassReason],
      );
      await client.query("UPDATE prompts SET updated_at = now() WHERE id = $1", [promptId]);
      return {
        id: event.rows[0]!.id, tag, fromVersion: from, toVersion: version, changedBy: userId, reason, createdAt: iso(event.rows[0]!.created_at),
        gateVerdict: gate.verdict, gateBypassed: gate.bypassed, bypassReason: gate.bypassReason,
      };
    });
  }

  async tagEvents(promptId: string, limit: number): Promise<PromptTagEvent[]> {
    if (!UUID.test(promptId)) return [];
    const { rows } = await this.pool.query<{
      id: string; tag: string; from_version: number | null; to_version: number | null; changed_by: string | null; reason: string; created_at: Ts;
      gate_verdict: string | null; gate_bypassed: boolean; bypass_reason: string | null;
    }>(
      `SELECT id, tag, from_version, to_version, changed_by, reason, created_at, gate_verdict, gate_bypassed, bypass_reason
         FROM prompt_tag_events WHERE prompt_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [promptId, limit],
    );
    return rows.map((r) => ({
      id: r.id, tag: r.tag, fromVersion: r.from_version, toVersion: r.to_version, changedBy: r.changed_by, reason: r.reason, createdAt: iso(r.created_at),
      gateVerdict: r.gate_verdict, gateBypassed: r.gate_bypassed, bypassReason: r.bypass_reason,
    }));
  }

  async wasServed(promptId: string, tag: string, version: number): Promise<boolean> {
    if (!UUID.test(promptId)) return false;
    const { rows } = await this.pool.query(
      "SELECT 1 FROM prompt_tag_events WHERE prompt_id = $1 AND tag = $2 AND to_version = $3 AND gate_bypassed = false LIMIT 1",
      [promptId, tag, version],
    );
    return rows.length > 0;
  }

  async createOverride(input: { tokenHash: string; experimentId: string; promptId: string; version: number; userId: string; ttlSeconds: number }): Promise<void> {
    await this.pool.query("DELETE FROM prompt_overrides WHERE expires_at < now() - interval '1 hour'");
    await this.pool.query(
      `INSERT INTO prompt_overrides (token_hash, experiment_id, prompt_id, version, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
      [input.tokenHash, input.experimentId, input.promptId, input.version, input.userId, input.ttlSeconds],
    );
  }

  async consumeOverride(tokenHash: string, experimentId: string): Promise<{ promptId: string; version: number } | null> {
    const { rows } = await this.pool.query<{ prompt_id: string; version: number }>(
      `UPDATE prompt_overrides SET resolved_count = resolved_count + 1, last_resolved_at = now()
        WHERE token_hash = $1 AND experiment_id = $2 AND expires_at > now()
        RETURNING prompt_id, version`,
      [tokenHash, experimentId],
    );
    return rows[0] ? { promptId: rows[0].prompt_id, version: rows[0].version } : null;
  }

  async overrideUses(tokenHash: string): Promise<number> {
    const { rows } = await this.pool.query<{ resolved_count: number }>("SELECT resolved_count FROM prompt_overrides WHERE token_hash = $1", [tokenHash]);
    return rows[0]?.resolved_count ?? 0;
  }

  async getPolicy(promptId: string): Promise<PromptPolicy | null> {
    if (!UUID.test(promptId)) return null;
    const { rows } = await this.pool.query<{ prompt_id: string; dataset_id: string | null; required_runs: number; updated_by: string | null; updated_at: Ts }>(
      "SELECT prompt_id, dataset_id, required_runs, updated_by, updated_at FROM prompt_policies WHERE prompt_id = $1",
      [promptId],
    );
    const r = rows[0];
    return r ? { promptId: r.prompt_id, datasetId: r.dataset_id, requiredRuns: r.required_runs, updatedBy: r.updated_by, updatedAt: iso(r.updated_at) } : null;
  }

  async setPolicy(promptId: string, policy: { datasetId: string; requiredRuns: number }, userId: string): Promise<PromptPolicy> {
    await this.pool.query(
      `INSERT INTO prompt_policies (prompt_id, dataset_id, required_runs, updated_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (prompt_id) DO UPDATE SET dataset_id = EXCLUDED.dataset_id, required_runs = EXCLUDED.required_runs, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [promptId, policy.datasetId, policy.requiredRuns, userId],
    );
    return (await this.getPolicy(promptId))!;
  }

  async deletePolicy(promptId: string): Promise<void> {
    if (UUID.test(promptId)) await this.pool.query("DELETE FROM prompt_policies WHERE prompt_id = $1", [promptId]);
  }

  async recordUsage(experimentId: string, environment: string, items: UsageItem[]): Promise<void> {
    await this.tx(async (client) => {
      for (const item of items) {
        await client.query(
          `INSERT INTO prompt_usage (prompt_id, experiment_id, environment, tag, version) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (prompt_id, experiment_id, environment, tag, version) DO UPDATE SET last_seen_at = now()`,
          [item.promptId, experimentId, environment, item.tag, item.version],
        );
      }
      await client.query(`DELETE FROM prompt_usage WHERE experiment_id = $1 AND last_seen_at < now() - interval '7 days'`, [experimentId]);
    });
  }

  async listUsage(promptId: string): Promise<PromptUsage[]> {
    if (!UUID.test(promptId)) return [];
    const { rows } = await this.pool.query<{ experiment_id: string; environment: string; tag: string; version: number; first_seen_at: Ts; last_seen_at: Ts }>(
      `SELECT experiment_id, environment, tag, version, first_seen_at, last_seen_at FROM prompt_usage
        WHERE prompt_id = $1 AND last_seen_at > now() - interval '7 days' ORDER BY last_seen_at DESC`,
      [promptId],
    );
    return rows.map((r) => ({ experimentId: r.experiment_id, environment: r.environment, tag: r.tag, version: r.version, firstSeenAt: iso(r.first_seen_at), lastSeenAt: iso(r.last_seen_at) }));
  }
}
