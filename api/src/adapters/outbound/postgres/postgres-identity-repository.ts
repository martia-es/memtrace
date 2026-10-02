import type { Pool } from "pg";
import { randomBytes, createHash } from "node:crypto";
import type { IdentityRepository } from "@/application/ports/identity-repository";
import type {
  ApiKey,
  CustomMetric,
  Dataset,
  DatasetItem,
  DatasetRun,
  Experiment,
  ExperimentAccess,
  ExperimentRole,
  ExperimentSummary,
  Member,
  OrgRole,
  Organization,
  OrganizationSummary,
  OrganizationTheme,
  PendingInvitation,
  PendingInvitationTarget,
  RadiusPreset,
  User,
} from "@/domain/identity";

const API_KEY_PREFIX = "mtk_";
const RADIUS_PRESETS = new Set<RadiusPreset>(["sharp", "soft", "round"]);

function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/** El JSONB puede venir vacío ('{}') o con claves parciales; siempre se devuelve la forma completa. */
function toOrganizationTheme(raw: unknown): OrganizationTheme {
  const value = (raw ?? {}) as Partial<OrganizationTheme>;
  const accentColor = typeof value.accentColor === "string" ? value.accentColor : null;
  const radiusPreset = RADIUS_PRESETS.has(value.radiusPreset as RadiusPreset) ? (value.radiusPreset as RadiusPreset) : null;
  return { accentColor, radiusPreset };
}

export class PostgresIdentityRepository implements IdentityRepository {
  constructor(private readonly pool: Pool) {}

  async getUserByEmail(email: string): Promise<User | null> {
    const { rows } = await this.pool.query<{ id: string; email: string; name: string | null; image: string | null }>(
      `SELECT id, email, name, image FROM users WHERE email = $1`,
      [email],
    );
    return rows[0] ?? null;
  }

  async createOrganization(name: string, ownerUserId: string): Promise<Organization> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{ id: string; name: string; theme: unknown }>(
        `INSERT INTO organizations (name) VALUES ($1) RETURNING id, name, theme`,
        [name],
      );
      const organization = rows[0];
      if (!organization) throw new Error("failed to insert organization");
      await client.query(
        `INSERT INTO org_memberships (organization_id, user_id, role) VALUES ($1, $2, 'org_admin')`,
        [organization.id, ownerUserId],
      );
      await client.query("COMMIT");
      return { id: organization.id, name: organization.name, theme: toOrganizationTheme(organization.theme) };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getOrganization(organizationId: string): Promise<Organization | null> {
    const { rows } = await this.pool.query<{ id: string; name: string; theme: unknown }>(
      `SELECT id, name, theme FROM organizations WHERE id = $1`,
      [organizationId],
    );
    const row = rows[0];
    return row ? { id: row.id, name: row.name, theme: toOrganizationTheme(row.theme) } : null;
  }

  async listOrganizationsForUser(userId: string): Promise<OrganizationSummary[]> {
    const { rows } = await this.pool.query<{ id: string; name: string; theme: unknown; my_role: OrgRole | null }>(
      `SELECT DISTINCT o.id, o.name, o.theme,
              CASE WHEN om.user_id IS NOT NULL THEN 'org_admin' ELSE NULL END AS my_role
         FROM organizations o
         LEFT JOIN org_memberships om ON om.organization_id = o.id AND om.user_id = $1
         LEFT JOIN experiments e ON e.organization_id = o.id
         LEFT JOIN experiment_memberships em ON em.experiment_id = e.id AND em.user_id = $1
        WHERE om.user_id IS NOT NULL OR em.user_id IS NOT NULL
        ORDER BY o.name`,
      [userId],
    );
    return rows.map((row) => ({ id: row.id, name: row.name, theme: toOrganizationTheme(row.theme), myRole: row.my_role }));
  }

  async updateOrganizationTheme(organizationId: string, theme: OrganizationTheme): Promise<Organization> {
    const { rows } = await this.pool.query<{ id: string; name: string; theme: unknown }>(
      `UPDATE organizations SET theme = $2 WHERE id = $1 RETURNING id, name, theme`,
      [organizationId, JSON.stringify(theme)],
    );
    const row = rows[0];
    if (!row) throw new Error("organization not found");
    return { id: row.id, name: row.name, theme: toOrganizationTheme(row.theme) };
  }

  async isOrgAdmin(userId: string, organizationId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM org_memberships WHERE user_id = $1 AND organization_id = $2`,
      [userId, organizationId],
    );
    return rows.length > 0;
  }

  async addOrgAdmin(organizationId: string, userId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO org_memberships (organization_id, user_id, role) VALUES ($1, $2, 'org_admin')
       ON CONFLICT (organization_id, user_id) DO NOTHING`,
      [organizationId, userId],
    );
  }

  async listOrgMembers(organizationId: string): Promise<Member[]> {
    const { rows } = await this.pool.query<{ user_id: string; email: string; name: string | null; role: OrgRole }>(
      `SELECT u.id AS user_id, u.email, u.name, m.role
         FROM org_memberships m
         JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = $1
        ORDER BY u.email`,
      [organizationId],
    );
    return rows.map(toMember);
  }

  async createExperiment(organizationId: string, name: string, serviceName: string): Promise<Experiment> {
    const { rows } = await this.pool.query<{ id: string; organization_id: string; name: string; service_name: string; org_theme: unknown }>(
      `WITH inserted AS (
         INSERT INTO experiments (organization_id, name, service_name) VALUES ($1, $2, $3)
         RETURNING id, organization_id, name, service_name
       )
       SELECT inserted.*, o.theme AS org_theme FROM inserted JOIN organizations o ON o.id = inserted.organization_id`,
      [organizationId, name, serviceName],
    );
    const row = rows[0];
    if (!row) throw new Error("failed to insert experiment");
    return toExperiment(row);
  }

  async getExperiment(experimentId: string): Promise<Experiment | null> {
    const { rows } = await this.pool.query<{ id: string; organization_id: string; name: string; service_name: string; org_theme: unknown }>(
      `SELECT e.id, e.organization_id, e.name, e.service_name, o.theme AS org_theme
         FROM experiments e
         JOIN organizations o ON o.id = e.organization_id
        WHERE e.id = $1`,
      [experimentId],
    );
    return rows[0] ? toExperiment(rows[0]) : null;
  }

  async listExperimentsForUser(userId: string): Promise<ExperimentSummary[]> {
    const { rows } = await this.pool.query<{
      id: string;
      organization_id: string;
      name: string;
      service_name: string;
      org_theme: unknown;
      my_role: ExperimentRole | null;
      org_admin: boolean;
    }>(
      `SELECT DISTINCT e.id, e.organization_id, e.name, e.service_name, o.theme AS org_theme,
              em.role AS my_role,
              (om.user_id IS NOT NULL) AS org_admin
         FROM experiments e
         JOIN organizations o ON o.id = e.organization_id
         LEFT JOIN experiment_memberships em ON em.experiment_id = e.id AND em.user_id = $1
         LEFT JOIN org_memberships om ON om.organization_id = e.organization_id AND om.user_id = $1
        WHERE em.user_id IS NOT NULL OR om.user_id IS NOT NULL
        ORDER BY e.name`,
      [userId],
    );
    return rows.map((row) => ({ ...toExperiment(row), myRole: row.org_admin ? "org_admin" : (row.my_role as ExperimentRole) }));
  }

  async addExperimentMember(experimentId: string, userId: string, role: ExperimentRole): Promise<void> {
    await this.pool.query(
      `INSERT INTO experiment_memberships (experiment_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (experiment_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [experimentId, userId, role],
    );
  }

  async listExperimentMembers(experimentId: string): Promise<Member[]> {
    const { rows } = await this.pool.query<{ user_id: string; email: string; name: string | null; role: ExperimentRole }>(
      `SELECT u.id AS user_id, u.email, u.name, m.role
         FROM experiment_memberships m
         JOIN users u ON u.id = m.user_id
        WHERE m.experiment_id = $1
        ORDER BY u.email`,
      [experimentId],
    );
    return rows.map(toMember);
  }

  async createPendingInvitation(email: string, target: PendingInvitationTarget, invitedByUserId: string): Promise<void> {
    const organizationId = "organizationId" in target ? target.organizationId : null;
    const experimentId = "experimentId" in target ? target.experimentId : null;
    await this.pool.query(
      `INSERT INTO pending_invitations (email, organization_id, experiment_id, role, invited_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [email, organizationId, experimentId, target.role, invitedByUserId],
    );
  }

  async applyPendingInvitations(userId: string, email: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{ id: string; organization_id: string | null; experiment_id: string | null; role: ExperimentAccess }>(
        `SELECT id, organization_id, experiment_id, role FROM pending_invitations WHERE email = $1`,
        [email],
      );
      for (const row of rows) {
        if (row.organization_id) {
          await client.query(
            `INSERT INTO org_memberships (organization_id, user_id, role) VALUES ($1, $2, 'org_admin')
             ON CONFLICT (organization_id, user_id) DO NOTHING`,
            [row.organization_id, userId],
          );
        } else if (row.experiment_id) {
          await client.query(
            `INSERT INTO experiment_memberships (experiment_id, user_id, role) VALUES ($1, $2, $3)
             ON CONFLICT (experiment_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
            [row.experiment_id, userId, row.role],
          );
        }
      }
      await client.query(`DELETE FROM pending_invitations WHERE email = $1`, [email]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async listPendingInvitations(target: { organizationId: string } | { experimentId: string }): Promise<PendingInvitation[]> {
    const column = "organizationId" in target ? "organization_id" : "experiment_id";
    const value = "organizationId" in target ? target.organizationId : target.experimentId;
    const { rows } = await this.pool.query<{
      id: string;
      email: string;
      organization_id: string | null;
      experiment_id: string | null;
      role: OrgRole | ExperimentRole;
      invited_by: string;
      created_at: string;
    }>(
      `SELECT id, email, organization_id, experiment_id, role, invited_by, created_at
         FROM pending_invitations
        WHERE ${column} = $1
        ORDER BY created_at DESC`,
      [value],
    );
    return rows.map(toPendingInvitation);
  }

  async resolveExperimentAccess(userId: string, experimentId: string): Promise<ExperimentAccess> {
    const { rows } = await this.pool.query<{ org_admin: boolean; experiment_role: ExperimentRole | null }>(
      `SELECT
         EXISTS (
           SELECT 1 FROM org_memberships om
             JOIN experiments e ON e.organization_id = om.organization_id
            WHERE om.user_id = $1 AND e.id = $2
         ) AS org_admin,
         (SELECT role FROM experiment_memberships WHERE user_id = $1 AND experiment_id = $2) AS experiment_role`,
      [userId, experimentId],
    );
    const row = rows[0];
    if (!row) return null;
    if (row.org_admin) return "org_admin";
    return row.experiment_role ?? null;
  }

  async createApiKey(experimentId: string, createdByUserId: string): Promise<{ apiKey: ApiKey; plaintext: string }> {
    const plaintext = `${API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
    const { rows } = await this.pool.query<{ id: string; experiment_id: string; key_prefix: string; created_at: string; last_used_at: string | null }>(
      `INSERT INTO api_keys (experiment_id, key_hash, key_prefix, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, experiment_id, key_prefix, created_at, last_used_at`,
      [experimentId, hashApiKey(plaintext), plaintext.slice(0, 12), createdByUserId],
    );
    const row = rows[0];
    if (!row) throw new Error("failed to insert api key");
    return { apiKey: toApiKey(row), plaintext };
  }

  async listApiKeys(experimentId: string): Promise<ApiKey[]> {
    const { rows } = await this.pool.query<{ id: string; experiment_id: string; key_prefix: string; created_at: string; last_used_at: string | null }>(
      `SELECT id, experiment_id, key_prefix, created_at, last_used_at
         FROM api_keys
        WHERE experiment_id = $1 AND revoked_at IS NULL
        ORDER BY created_at DESC`,
      [experimentId],
    );
    return rows.map(toApiKey);
  }

  async revokeApiKey(experimentId: string, keyId: string): Promise<void> {
    await this.pool.query(`UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND experiment_id = $2`, [keyId, experimentId]);
  }

  async resolveApiKey(plaintext: string): Promise<{ experimentId: string; serviceName: string; createdByUserId: string } | null> {
    const { rows } = await this.pool.query<{ id: string; experiment_id: string; service_name: string; created_by: string }>(
      `SELECT k.id, k.experiment_id, e.service_name, k.created_by
         FROM api_keys k
         JOIN experiments e ON e.id = k.experiment_id
        WHERE k.key_hash = $1 AND k.revoked_at IS NULL`,
      [hashApiKey(plaintext)],
    );
    const row = rows[0];
    if (!row) return null;
    // no bloqueante: no hace falta esperar a que se confirme para responder al agente
    void this.pool.query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [row.id]);
    return { experimentId: row.experiment_id, serviceName: row.service_name, createdByUserId: row.created_by };
  }

  async listCustomMetrics(experimentId: string): Promise<CustomMetric[]> {
    const { rows } = await this.pool.query<{ id: string; experiment_id: string; name: string; definition: unknown; created_at: string }>(
      `SELECT id, experiment_id, name, definition, created_at
         FROM custom_metrics
        WHERE experiment_id = $1
        ORDER BY created_at DESC`,
      [experimentId],
    );
    return rows.map(toCustomMetric);
  }

  async createCustomMetric(experimentId: string, createdByUserId: string, name: string, definition: Record<string, unknown>): Promise<CustomMetric> {
    const { rows } = await this.pool.query<{ id: string; experiment_id: string; name: string; definition: unknown; created_at: string }>(
      `INSERT INTO custom_metrics (experiment_id, name, definition, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, experiment_id, name, definition, created_at`,
      [experimentId, name, JSON.stringify(definition), createdByUserId],
    );
    const row = rows[0];
    if (!row) throw new Error("failed to insert custom metric");
    return toCustomMetric(row);
  }

  async deleteCustomMetric(experimentId: string, metricId: string): Promise<void> {
    await this.pool.query(`DELETE FROM custom_metrics WHERE id = $1 AND experiment_id = $2`, [metricId, experimentId]);
  }

  async listDatasets(experimentId: string): Promise<Dataset[]> {
    const { rows } = await this.pool.query<{ id: string; experiment_id: string; name: string; created_at: string }>(
      `SELECT id, experiment_id, name, created_at FROM datasets WHERE experiment_id = $1 ORDER BY created_at DESC`,
      [experimentId],
    );
    return rows.map(toDataset);
  }

  async createDataset(experimentId: string, createdByUserId: string, name: string): Promise<Dataset> {
    const { rows } = await this.pool.query<{ id: string; experiment_id: string; name: string; created_at: string }>(
      `INSERT INTO datasets (experiment_id, name, created_by) VALUES ($1, $2, $3)
       RETURNING id, experiment_id, name, created_at`,
      [experimentId, name, createdByUserId],
    );
    const row = rows[0];
    if (!row) throw new Error("failed to insert dataset");
    return toDataset(row);
  }

  async getDataset(datasetId: string): Promise<Dataset | null> {
    const { rows } = await this.pool.query<{ id: string; experiment_id: string; name: string; created_at: string }>(
      `SELECT id, experiment_id, name, created_at FROM datasets WHERE id = $1`,
      [datasetId],
    );
    return rows[0] ? toDataset(rows[0]) : null;
  }

  async addDatasetItems(
    datasetId: string,
    items: Array<{ input: unknown; expectedOutput: unknown; metadata: Record<string, unknown> | null }>,
  ): Promise<DatasetItem[]> {
    const inserted: DatasetItem[] = [];
    for (const item of items) {
      const { rows } = await this.pool.query<{ id: string; dataset_id: string; input: unknown; expected_output: unknown; metadata: unknown }>(
        `INSERT INTO dataset_items (dataset_id, input, expected_output, metadata) VALUES ($1, $2, $3, $4)
         RETURNING id, dataset_id, input, expected_output, metadata`,
        [datasetId, JSON.stringify(item.input), item.expectedOutput === undefined ? null : JSON.stringify(item.expectedOutput), item.metadata ? JSON.stringify(item.metadata) : null],
      );
      const row = rows[0];
      if (!row) throw new Error("failed to insert dataset item");
      inserted.push(toDatasetItem(row));
    }
    return inserted;
  }

  async listDatasetItems(datasetId: string): Promise<DatasetItem[]> {
    const { rows } = await this.pool.query<{ id: string; dataset_id: string; input: unknown; expected_output: unknown; metadata: unknown }>(
      `SELECT id, dataset_id, input, expected_output, metadata FROM dataset_items WHERE dataset_id = $1 ORDER BY created_at ASC`,
      [datasetId],
    );
    return rows.map(toDatasetItem);
  }

  async createDatasetRun(id: string, datasetId: string, name: string, itemCount: number): Promise<DatasetRun> {
    const { rows } = await this.pool.query<{ id: string; dataset_id: string; name: string; item_count: number; created_at: string }>(
      `INSERT INTO dataset_runs (id, dataset_id, name, item_count) VALUES ($1, $2, $3, $4)
       RETURNING id, dataset_id, name, item_count, created_at`,
      [id, datasetId, name, itemCount],
    );
    const row = rows[0];
    if (!row) throw new Error("failed to insert dataset run");
    return toDatasetRun(row);
  }

  async listDatasetRuns(datasetId: string): Promise<DatasetRun[]> {
    const { rows } = await this.pool.query<{ id: string; dataset_id: string; name: string; item_count: number; created_at: string }>(
      `SELECT id, dataset_id, name, item_count, created_at FROM dataset_runs WHERE dataset_id = $1 ORDER BY created_at DESC`,
      [datasetId],
    );
    return rows.map(toDatasetRun);
  }

  async getDatasetRun(runId: string): Promise<DatasetRun | null> {
    const { rows } = await this.pool.query<{ id: string; dataset_id: string; name: string; item_count: number; created_at: string }>(
      `SELECT id, dataset_id, name, item_count, created_at FROM dataset_runs WHERE id = $1`,
      [runId],
    );
    return rows[0] ? toDatasetRun(rows[0]) : null;
  }
}

function toApiKey(row: { id: string; experiment_id: string; key_prefix: string; created_at: string; last_used_at: string | null }): ApiKey {
  return { id: row.id, experimentId: row.experiment_id, keyPrefix: row.key_prefix, createdAt: row.created_at, lastUsedAt: row.last_used_at };
}

function toCustomMetric(row: { id: string; experiment_id: string; name: string; definition: unknown; created_at: string }): CustomMetric {
  return {
    id: row.id,
    experimentId: row.experiment_id,
    name: row.name,
    definition: (row.definition ?? {}) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

function toExperiment(row: { id: string; organization_id: string; name: string; service_name: string; org_theme: unknown }): Experiment {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    serviceName: row.service_name,
    organizationTheme: toOrganizationTheme(row.org_theme),
  };
}

function toMember(row: { user_id: string; email: string; name: string | null; role: OrgRole | ExperimentRole }): Member {
  return { userId: row.user_id, email: row.email, name: row.name, role: row.role };
}

function toDataset(row: { id: string; experiment_id: string; name: string; created_at: string }): Dataset {
  return { id: row.id, experimentId: row.experiment_id, name: row.name, createdAt: row.created_at };
}

function toDatasetItem(row: { id: string; dataset_id: string; input: unknown; expected_output: unknown; metadata: unknown }): DatasetItem {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    input: row.input,
    expectedOutput: row.expected_output,
    metadata: (row.metadata ?? null) as Record<string, unknown> | null,
  };
}

function toDatasetRun(row: { id: string; dataset_id: string; name: string; item_count: number; created_at: string }): DatasetRun {
  return { id: row.id, datasetId: row.dataset_id, name: row.name, itemCount: row.item_count, createdAt: row.created_at };
}

function toPendingInvitation(row: {
  id: string;
  email: string;
  organization_id: string | null;
  experiment_id: string | null;
  role: OrgRole | ExperimentRole;
  invited_by: string;
  created_at: string;
}): PendingInvitation {
  const target = (
    row.organization_id
      ? { organizationId: row.organization_id, role: row.role as OrgRole }
      : { experimentId: row.experiment_id as string, role: row.role as ExperimentRole }
  ) as PendingInvitationTarget;
  return { id: row.id, email: row.email, invitedByUserId: row.invited_by, target, createdAt: row.created_at };
}
