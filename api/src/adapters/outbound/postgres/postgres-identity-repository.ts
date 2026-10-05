import type { Pool } from "pg";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { bumpForChanges, describeChanges } from "@/domain/dataset-version";
import { ValidationError } from "@/domain/errors";
import type { IdentityRepository, PromotedTraceLocation } from "@/application/ports/identity-repository";
import { isPermission, type Permission } from "@/domain/permissions";
import { DEFAULT_ENVIRONMENTS, type AgentProfile } from "@/domain/assistant-registry";
import type {
  ApiKey,
  CustomMetric,
  Dataset,
  DatasetItem,
  DatasetRun,
  DatasetRunStatus,
  DatasetRunWithDataset,
  DatasetVersion,
  Experiment,
  ExperimentAccess,
  ExperimentRole,
  ExperimentSummary,
  Member,
  MetricReport,
  MetricReportChartLayout,
  MetricReportWithCharts,
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

/** Columnas + joins de autoría/edición/borrado comunes a toda lectura de `dataset_items` (ADR-032). */
const DATASET_ITEM_SELECT = `
  i.id, i.origin_item_id, i.dataset_version_id, i.input, i.expected_output, i.metadata,
  i.created_by, cu.email AS created_by_email, i.created_at,
  i.updated_by, uu.email AS updated_by_email, i.updated_at,
  i.deleted_by, du.email AS deleted_by_email, i.deleted_at
`;

interface DatasetItemRow {
  id: string;
  origin_item_id: string;
  dataset_version_id: string;
  input: unknown;
  expected_output: unknown;
  metadata: unknown;
  created_by: string;
  created_by_email: string;
  created_at: string;
  updated_by: string | null;
  updated_by_email: string | null;
  updated_at: string | null;
  deleted_by: string | null;
  deleted_by_email: string | null;
  deleted_at: string | null;
}

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

/** Expresión SQL: el `metadata` nuevo, conservando la clave reservada `promotedFrom` (ADR-038) del anterior si la había.
 * Editar el resto del metadata de un item promovido nunca debe borrar de dónde salió. */
function keepPromotedFrom(next: string, current: string): string {
  return `CASE WHEN jsonb_exists(${current}, 'promotedFrom')
            THEN COALESCE(CASE WHEN jsonb_typeof(${next}) = 'object' THEN ${next} END, '{}'::jsonb) || jsonb_build_object('promotedFrom', ${current}->'promotedFrom')
            ELSE ${next} END`;
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

  async getUsersByIds(userIds: string[]): Promise<User[]> {
    if (userIds.length === 0) return [];
    const { rows } = await this.pool.query<{ id: string; email: string; name: string | null; image: string | null }>(
      `SELECT id, email, name, image FROM users WHERE id = ANY($1::uuid[])`,
      [userIds],
    );
    return rows;
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
      for (const env of DEFAULT_ENVIRONMENTS) {
        await client.query(
          `INSERT INTO environments (organization_id, key, label, position, is_production, health_interval_seconds) VALUES ($1, $2, $3, $4, $5, $6)`,
          [organization.id, env.key, env.label, env.position, env.isProduction, env.healthIntervalSeconds],
        );
      }
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
    const { rows } = await this.pool.query<{ id: string; name: string; theme: unknown; my_role: OrgRole | null; permissions: string[] | null }>(
      `SELECT DISTINCT o.id, o.name, o.theme, om.role AS my_role,
              (SELECT array_agg(rp.permission) FROM role_permissions rp WHERE rp.role_name = om.role) AS permissions
         FROM organizations o
         LEFT JOIN org_memberships om ON om.organization_id = o.id AND om.user_id = $1
         LEFT JOIN experiments e ON e.organization_id = o.id
         LEFT JOIN experiment_memberships em ON em.experiment_id = e.id AND em.user_id = $1
        WHERE om.user_id IS NOT NULL OR em.user_id IS NOT NULL
        ORDER BY o.name`,
      [userId],
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      theme: toOrganizationTheme(row.theme),
      myRole: row.my_role,
      permissions: (row.permissions ?? []).filter(isPermission),
    }));
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

  /** Antes bastaba con tener cualquier membresía de organización; con roles de organización distintos de org_admin (p. ej. `governance`) hay que mirar el permiso. */
  async isOrgAdmin(userId: string, organizationId: string): Promise<boolean> {
    return this.hasOrganizationPermission(userId, organizationId, "org:manage");
  }

  async hasOrganizationPermission(userId: string, organizationId: string, permission: Permission): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM org_memberships om JOIN role_permissions rp ON rp.role_name = om.role
        WHERE om.user_id = $1 AND om.organization_id = $2 AND rp.permission = $3 LIMIT 1`,
      [userId, organizationId, permission],
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
    const { rows } = await this.pool.query<{ user_id: string; email: string; name: string | null; role: OrgRole; source: Member["source"] }>(
      `SELECT u.id AS user_id, u.email, u.name, m.role, m.source
         FROM org_memberships m
         JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = $1
        ORDER BY u.email`,
      [organizationId],
    );
    return rows.map(toMember);
  }

  async createExperiment(organizationId: string, name: string, serviceName: string, profile: Partial<AgentProfile> = {}): Promise<Experiment> {
    const { rows } = await this.pool.query<{ id: string; organization_id: string; name: string; service_name: string; org_theme: unknown }>(
      `WITH inserted AS (
         INSERT INTO experiments (organization_id, name, service_name, description, owner_user_id) VALUES ($1, $2, $3, $4, $5)
         RETURNING id, organization_id, name, service_name
       )
       SELECT inserted.*, o.theme AS org_theme FROM inserted JOIN organizations o ON o.id = inserted.organization_id`,
      [organizationId, name, serviceName, profile.description ?? "", profile.ownerUserId ?? null],
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
      my_role: string | null;
      org_role: string | null;
      permissions: string[] | null;
    }>(
      `SELECT e.id, e.organization_id, e.name, e.service_name, o.theme AS org_theme,
              em.role AS my_role, om.role AS org_role,
              (SELECT array_agg(DISTINCT rp.permission) FROM role_permissions rp WHERE rp.role_name IN (em.role, om.role)) AS permissions
         FROM experiments e
         JOIN organizations o ON o.id = e.organization_id
         LEFT JOIN experiment_memberships em ON em.experiment_id = e.id AND em.user_id = $1
         LEFT JOIN org_memberships om ON om.organization_id = e.organization_id AND om.user_id = $1
        WHERE em.user_id IS NOT NULL OR om.user_id IS NOT NULL
        ORDER BY e.name`,
      [userId],
    );
    return rows.map((row) => ({
      ...toExperiment(row),
      myRole: row.my_role ?? (row.org_role as string),
      permissions: (row.permissions ?? []).filter(isPermission),
    }));
  }

  async addExperimentMember(experimentId: string, userId: string, role: ExperimentRole): Promise<void> {
    await this.pool.query(
      `INSERT INTO experiment_memberships (experiment_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (experiment_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [experimentId, userId, role],
    );
  }

  async listExperimentMembers(experimentId: string): Promise<Member[]> {
    const { rows } = await this.pool.query<{ user_id: string; email: string; name: string | null; role: ExperimentRole; source: Member["source"] }>(
      `SELECT u.id AS user_id, u.email, u.name, m.role, m.source
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
      const { rows } = await client.query<{ id: string; organization_id: string | null; experiment_id: string | null; role: string }>(
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
    const { rows } = await this.pool.query<{ org_role: string | null; experiment_role: string | null; permissions: string[] | null }>(
      `SELECT
         (SELECT om.role FROM org_memberships om JOIN experiments e ON e.organization_id = om.organization_id
           WHERE om.user_id = $1 AND e.id = $2) AS org_role,
         (SELECT role FROM experiment_memberships WHERE user_id = $1 AND experiment_id = $2) AS experiment_role,
         (SELECT array_agg(DISTINCT rp.permission)
            FROM role_permissions rp
           WHERE rp.role_name IN (
                   (SELECT om.role FROM org_memberships om JOIN experiments e ON e.organization_id = om.organization_id
                     WHERE om.user_id = $1 AND e.id = $2),
                   (SELECT role FROM experiment_memberships WHERE user_id = $1 AND experiment_id = $2))) AS permissions`,
      [userId, experimentId],
    );
    const row = rows[0];
    if (!row || (!row.org_role && !row.experiment_role)) return null;
    return { role: row.experiment_role ?? (row.org_role as string), permissions: (row.permissions ?? []).filter(isPermission) };
  }

  async listRoleNames(scope: "organization" | "experiment"): Promise<string[]> {
    const { rows } = await this.pool.query<{ name: string }>(`SELECT name FROM roles WHERE scope = $1 ORDER BY name`, [scope]);
    return rows.map((r) => r.name);
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

  async listApiKeys(experimentId: string, createdBy?: string): Promise<ApiKey[]> {
    const { rows } = await this.pool.query<{ id: string; experiment_id: string; key_prefix: string; created_at: string; last_used_at: string | null }>(
      `SELECT id, experiment_id, key_prefix, created_at, last_used_at
         FROM api_keys
        WHERE experiment_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR created_by = $2)
        ORDER BY created_at DESC`,
      [experimentId, createdBy ?? null],
    );
    return rows.map(toApiKey);
  }

  async revokeApiKey(experimentId: string, keyId: string, createdBy?: string): Promise<void> {
    await this.pool.query(`UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND experiment_id = $2 AND ($3::uuid IS NULL OR created_by = $3)`, [keyId, experimentId, createdBy ?? null]);
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

  async listMetricReports(experimentId: string): Promise<MetricReport[]> {
    const { rows } = await this.pool.query<{ id: string; experiment_id: string; name: string; created_at: string; updated_at: string }>(
      `SELECT id, experiment_id, name, created_at, updated_at
         FROM metric_reports
        WHERE experiment_id = $1
        ORDER BY created_at ASC`,
      [experimentId],
    );
    return rows.map(toMetricReport);
  }

  async createMetricReport(experimentId: string, createdByUserId: string, name: string): Promise<MetricReport> {
    const { rows } = await this.pool.query<{ id: string; experiment_id: string; name: string; created_at: string; updated_at: string }>(
      `INSERT INTO metric_reports (experiment_id, name, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, experiment_id, name, created_at, updated_at`,
      [experimentId, name, createdByUserId],
    );
    const row = rows[0];
    if (!row) throw new Error("failed to insert metric report");
    return toMetricReport(row);
  }

  async getMetricReport(experimentId: string, reportId: string): Promise<MetricReportWithCharts | null> {
    const { rows: reportRows } = await this.pool.query<{ id: string; experiment_id: string; name: string; created_at: string; updated_at: string }>(
      `SELECT id, experiment_id, name, created_at, updated_at FROM metric_reports WHERE id = $1 AND experiment_id = $2`,
      [reportId, experimentId],
    );
    const reportRow = reportRows[0];
    if (!reportRow) return null;

    const { rows: chartRows } = await this.pool.query<{
      custom_metric_id: string;
      name: string;
      definition: unknown;
      grid_x: number;
      grid_y: number;
      grid_w: number;
      grid_h: number;
    }>(
      `SELECT rc.custom_metric_id, cm.name, cm.definition, rc.grid_x, rc.grid_y, rc.grid_w, rc.grid_h
         FROM metric_report_charts rc
         JOIN custom_metrics cm ON cm.id = rc.custom_metric_id
        WHERE rc.report_id = $1
        ORDER BY rc.grid_y, rc.grid_x`,
      [reportId],
    );

    return {
      ...toMetricReport(reportRow),
      charts: chartRows.map((r) => ({
        customMetricId: r.custom_metric_id,
        name: r.name,
        definition: r.definition as Record<string, unknown>,
        x: r.grid_x,
        y: r.grid_y,
        w: r.grid_w,
        h: r.grid_h,
      })),
    };
  }

  async renameMetricReport(experimentId: string, reportId: string, name: string): Promise<void> {
    await this.pool.query(`UPDATE metric_reports SET name = $1, updated_at = now() WHERE id = $2 AND experiment_id = $3`, [name, reportId, experimentId]);
  }

  async deleteMetricReport(experimentId: string, reportId: string): Promise<void> {
    await this.pool.query(`DELETE FROM metric_reports WHERE id = $1 AND experiment_id = $2`, [reportId, experimentId]);
  }

  async setMetricReportCharts(experimentId: string, reportId: string, charts: MetricReportChartLayout[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // el report tiene que pertenecer al experimento del caller antes de tocar nada
      const { rows } = await client.query(`SELECT 1 FROM metric_reports WHERE id = $1 AND experiment_id = $2`, [reportId, experimentId]);
      if (!rows[0]) throw new Error("metric report not found for this experiment");

      await client.query(`DELETE FROM metric_report_charts WHERE report_id = $1`, [reportId]);
      for (const c of charts) {
        await client.query(
          `INSERT INTO metric_report_charts (report_id, custom_metric_id, grid_x, grid_y, grid_w, grid_h)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [reportId, c.customMetricId, c.x, c.y, c.w, c.h],
        );
      }
      await client.query(`UPDATE metric_reports SET updated_at = now() WHERE id = $1`, [reportId]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async listDatasets(experimentId: string): Promise<Dataset[]> {
    const { rows } = await this.pool.query<{ id: string; experiment_id: string; name: string; created_at: string }>(
      `SELECT id, experiment_id, name, created_at FROM datasets WHERE experiment_id = $1 ORDER BY created_at DESC`,
      [experimentId],
    );
    return rows.map(toDataset);
  }

  async createDataset(experimentId: string, createdByUserId: string, name: string): Promise<Dataset> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{ id: string; experiment_id: string; name: string; created_at: string }>(
        `INSERT INTO datasets (experiment_id, name, created_by) VALUES ($1, $2, $3)
         RETURNING id, experiment_id, name, created_at`,
        [experimentId, name, createdByUserId],
      );
      const row = rows[0];
      if (!row) throw new Error("failed to insert dataset");
      // todo dataset nace con una versión 1.0 vacía (ADR-031/032): así `getLatestDatasetVersion` siempre tiene a qué apuntar.
      await client.query(`INSERT INTO dataset_versions (dataset_id, major, minor, created_by) VALUES ($1, 1, 0, $2)`, [row.id, createdByUserId]);
      await client.query("COMMIT");
      return toDataset(row);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getDataset(datasetId: string): Promise<Dataset | null> {
    const { rows } = await this.pool.query<{ id: string; experiment_id: string; name: string; created_at: string }>(
      `SELECT id, experiment_id, name, created_at FROM datasets WHERE id = $1`,
      [datasetId],
    );
    return rows[0] ? toDataset(rows[0]) : null;
  }

  async deleteDataset(datasetId: string): Promise<void> {
    await this.pool.query(`DELETE FROM datasets WHERE id = $1`, [datasetId]);
  }

  async listDatasetVersions(datasetId: string): Promise<DatasetVersion[]> {
    const { rows } = await this.pool.query<{ id: string; dataset_id: string; major: number; minor: number; note: string | null; created_by: string; created_by_email: string; created_at: string }>(
      `SELECT v.id, v.dataset_id, v.major, v.minor, v.note, v.created_by, u.email AS created_by_email, v.created_at
         FROM dataset_versions v JOIN users u ON u.id = v.created_by
        WHERE v.dataset_id = $1
        ORDER BY v.major DESC, v.minor DESC`,
      [datasetId],
    );
    return rows.map(toDatasetVersion);
  }

  async getLatestDatasetVersion(datasetId: string): Promise<DatasetVersion | null> {
    const { rows } = await this.pool.query<{ id: string; dataset_id: string; major: number; minor: number; note: string | null; created_by: string; created_by_email: string; created_at: string }>(
      `SELECT v.id, v.dataset_id, v.major, v.minor, v.note, v.created_by, u.email AS created_by_email, v.created_at
         FROM dataset_versions v JOIN users u ON u.id = v.created_by
        WHERE v.dataset_id = $1
        ORDER BY v.major DESC, v.minor DESC LIMIT 1`,
      [datasetId],
    );
    return rows[0] ? toDatasetVersion(rows[0]) : null;
  }

  /** Clona los items ACTIVOS (`deleted_at IS NULL`) de la última versión a una nueva (bump MAJOR
   * o MINOR, ADR-032), aplicando `editItem` o `deleteItem` sobre la fila correspondiente si se da.
   * Un tombstone de una versión anterior nunca se re-clona hacia adelante: solo vive en la
   * versión donde se registró el borrado. Usado por
   * `addDatasetItems`/`updateDatasetItem`/`deleteDatasetItem` — nunca se llama a mano. */
  private async createNextVersion(
    client: import("pg").PoolClient,
    datasetId: string,
    versionCreatedByUserId: string,
    note: string,
    bump: "major" | "minor",
    options: {
      editItem?: { itemId: string; updatedByUserId: string; patch: { input?: unknown; expectedOutput?: unknown; metadata?: Record<string, unknown> | null } };
      deleteItem?: { itemId: string; deletedByUserId: string };
      /** El caller clona los items él mismo (`commitDatasetChanges`, ADR-041). */
      skipClone?: boolean;
    } = {},
  ): Promise<{ id: string; major: number; minor: number }> {
    const { rows: latestRows } = await client.query<{ id: string; major: number; minor: number }>(
      `SELECT id, major, minor FROM dataset_versions WHERE dataset_id = $1 ORDER BY major DESC, minor DESC LIMIT 1`,
      [datasetId],
    );
    const latest = latestRows[0];
    const nextMajor = bump === "major" ? (latest?.major ?? 0) + 1 : latest?.major ?? 1;
    const nextMinor = bump === "major" ? 0 : (latest?.minor ?? 0) + 1;
    const { rows } = await client.query<{ id: string; major: number; minor: number }>(
      `INSERT INTO dataset_versions (dataset_id, major, minor, note, created_by) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, major, minor`,
      [datasetId, nextMajor, nextMinor, note, versionCreatedByUserId],
    );
    const version = rows[0];
    if (!version) throw new Error("failed to insert dataset version");
    if (latest && !options.skipClone) {
      if (options.editItem) {
        const { itemId, updatedByUserId, patch } = options.editItem;
        await client.query(
          `INSERT INTO dataset_items (dataset_version_id, origin_item_id, input, expected_output, metadata, created_by, created_at, updated_by, updated_at)
           SELECT $1, origin_item_id, CASE WHEN id = $3 THEN COALESCE($4::jsonb, input) ELSE input END,
                      CASE WHEN id = $3 THEN COALESCE($5::jsonb, expected_output) ELSE expected_output END,
                      CASE WHEN id = $3 AND $6::jsonb IS NOT NULL THEN ${keepPromotedFrom("$6::jsonb", "metadata")} ELSE metadata END,
                      created_by, created_at,
                      CASE WHEN id = $3 THEN $7::uuid ELSE updated_by END,
                      CASE WHEN id = $3 THEN now() ELSE updated_at END
             FROM dataset_items WHERE dataset_version_id = $2 AND deleted_at IS NULL`,
          [
            version.id,
            latest.id,
            itemId,
            patch.input === undefined ? null : JSON.stringify(patch.input),
            patch.expectedOutput === undefined ? null : JSON.stringify(patch.expectedOutput),
            patch.metadata === undefined ? null : JSON.stringify(patch.metadata),
            updatedByUserId,
          ],
        );
      } else if (options.deleteItem) {
        const { itemId, deletedByUserId } = options.deleteItem;
        // los items que sobreviven, tal cual (nunca se re-clona un tombstone ya existente)
        await client.query(
          `INSERT INTO dataset_items (dataset_version_id, origin_item_id, input, expected_output, metadata, created_by, created_at, updated_by, updated_at)
           SELECT $1, origin_item_id, input, expected_output, metadata, created_by, created_at, updated_by, updated_at
             FROM dataset_items WHERE dataset_version_id = $2 AND deleted_at IS NULL AND id != $3`,
          [version.id, latest.id, itemId],
        );
        // el item borrado: mismo contenido y autoría original, pero marcado como tombstone aquí.
        await client.query(
          `INSERT INTO dataset_items (dataset_version_id, origin_item_id, input, expected_output, metadata, created_by, created_at, deleted_by, deleted_at)
           SELECT $1, origin_item_id, input, expected_output, metadata, created_by, created_at, $3, now()
             FROM dataset_items WHERE id = $2`,
          [version.id, itemId, deletedByUserId],
        );
      } else {
        await client.query(
          `INSERT INTO dataset_items (dataset_version_id, origin_item_id, input, expected_output, metadata, created_by, created_at, updated_by, updated_at)
           SELECT $1, origin_item_id, input, expected_output, metadata, created_by, created_at, updated_by, updated_at
             FROM dataset_items WHERE dataset_version_id = $2 AND deleted_at IS NULL`,
          [version.id, latest.id],
        );
      }
    }
    return version;
  }

  async addDatasetItems(
    datasetId: string,
    createdByUserId: string,
    items: Array<{ input: unknown; expectedOutput: unknown; metadata: Record<string, unknown> | null }>,
  ): Promise<DatasetItem[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const note = items.length === 1 ? "Added item" : `Added ${items.length} items`;
      const version = await this.createNextVersion(client, datasetId, createdByUserId, note, "major");
      const inserted = await this.insertNewItems(client, version.id, createdByUserId, items);
      await client.query("COMMIT");
      return inserted;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async findPromotedTraces(experimentId: string, traceIds: string[]): Promise<PromotedTraceLocation[]> {
    if (traceIds.length === 0) return [];
    const { rows } = await this.pool.query<{ trace_id: string; dataset_id: string; dataset_name: string; major: number; minor: number }>(
      `SELECT DISTINCT i.metadata->'promotedFrom'->>'traceId' AS trace_id, d.id AS dataset_id, d.name AS dataset_name, v.major, v.minor
         FROM datasets d
         JOIN LATERAL (SELECT id, major, minor FROM dataset_versions WHERE dataset_id = d.id ORDER BY major DESC, minor DESC LIMIT 1) v ON true
         JOIN dataset_items i ON i.dataset_version_id = v.id AND i.deleted_at IS NULL
        WHERE d.experiment_id = $1 AND i.metadata->'promotedFrom'->>'traceId' = ANY($2::text[])`,
      [experimentId, traceIds],
    );
    return rows.map((r) => ({ traceId: r.trace_id, datasetId: r.dataset_id, datasetName: r.dataset_name, version: `${r.major}.${r.minor}` }));
  }

  async addPromotedDatasetItems(
    datasetId: string,
    createdByUserId: string,
    items: Array<{ traceId: string; input: unknown; expectedOutput: unknown; metadata: Record<string, unknown> }>,
  ): Promise<{ added: DatasetItem[]; alreadyPromoted: string[]; version: DatasetVersion | null }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Serializa a los escritores del dataset: sin esto dos promociones concurrentes del mismo traceId pasan ambas la comprobación (ADR-038).
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [datasetId]);
      const { rows } = await client.query<{ trace_id: string }>(
        `SELECT DISTINCT i.metadata->'promotedFrom'->>'traceId' AS trace_id
           FROM dataset_items i
          WHERE i.deleted_at IS NULL
            AND i.dataset_version_id = (SELECT id FROM dataset_versions WHERE dataset_id = $1 ORDER BY major DESC, minor DESC LIMIT 1)
            AND i.metadata->'promotedFrom'->>'traceId' = ANY($2::text[])`,
        [datasetId, items.map((i) => i.traceId)],
      );
      const existing = new Set(rows.map((r) => r.trace_id));
      const fresh = items.filter((i) => !existing.has(i.traceId));
      const alreadyPromoted = items.filter((i) => existing.has(i.traceId)).map((i) => i.traceId);
      if (fresh.length === 0) {
        await client.query("ROLLBACK");
        return { added: [], alreadyPromoted, version: null };
      }
      const note = fresh.length === 1 ? "Added item from trace" : `Added ${fresh.length} items from traces`;
      const version = await this.createNextVersion(client, datasetId, createdByUserId, note, "major");
      const added = await this.insertNewItems(client, version.id, createdByUserId, fresh);
      await client.query("COMMIT");
      return { added, alreadyPromoted, version: await this.getLatestDatasetVersion(datasetId) };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /** Un item nuevo es su propio origen (ADR-033): `id` y `origin_item_id` coinciden en su primera versión. */
  private async insertNewItems(
    client: import("pg").PoolClient,
    versionId: string,
    createdByUserId: string,
    items: Array<{ input: unknown; expectedOutput: unknown; metadata: Record<string, unknown> | null }>,
  ): Promise<DatasetItem[]> {
    const inserted: DatasetItem[] = [];
    for (const item of items) {
      const itemId = randomUUID();
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO dataset_items (id, origin_item_id, dataset_version_id, input, expected_output, metadata, created_by)
         VALUES ($1, $1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [itemId, versionId, JSON.stringify(item.input), item.expectedOutput === undefined ? null : JSON.stringify(item.expectedOutput), item.metadata ? JSON.stringify(item.metadata) : null, createdByUserId],
      );
      const row = rows[0];
      if (!row) throw new Error("failed to insert dataset item");
      const insertedItem = await this.getDatasetItemWithEmails(client, row.id);
      if (!insertedItem) throw new Error("failed to read back inserted dataset item");
      inserted.push(insertedItem);
    }
    return inserted;
  }

  private async getDatasetItemWithEmails(client: import("pg").PoolClient | Pool, itemId: string): Promise<DatasetItem | null> {
    const { rows } = await client.query<DatasetItemRow>(
      `SELECT ${DATASET_ITEM_SELECT} FROM dataset_items i
         JOIN users cu ON cu.id = i.created_by
         LEFT JOIN users uu ON uu.id = i.updated_by
         LEFT JOIN users du ON du.id = i.deleted_by
        WHERE i.id = $1`,
      [itemId],
    );
    return rows[0] ? toDatasetItem(rows[0]) : null;
  }

  /** Items activos de una versión — lo que ve el dashboard como "items actuales" (ADR-032). */
  async listDatasetItems(datasetVersionId: string): Promise<DatasetItem[]> {
    const { rows } = await this.pool.query<DatasetItemRow>(
      `SELECT ${DATASET_ITEM_SELECT} FROM dataset_items i
         JOIN users cu ON cu.id = i.created_by
         LEFT JOIN users uu ON uu.id = i.updated_by
         LEFT JOIN users du ON du.id = i.deleted_by
        WHERE i.dataset_version_id = $1 AND i.deleted_at IS NULL
        ORDER BY i.created_at ASC`,
      [datasetVersionId],
    );
    return rows.map(toDatasetItem);
  }

  /** Todos los items de una versión, incluidos los tombstones de items borrados en ella — para
   * inspeccionar el historial (ADR-032 follow-up), nunca para editar. */
  /** Todos los items (tombstones incluidos) de todas las versiones de un dataset, para calcular el
   * diff de cada versión contra su anterior sin una consulta por versión (ADR-033). */
  async listAllDatasetItemsWithDeleted(datasetId: string): Promise<DatasetItem[]> {
    const { rows } = await this.pool.query<DatasetItemRow>(
      `SELECT ${DATASET_ITEM_SELECT} FROM dataset_items i
         JOIN dataset_versions v ON v.id = i.dataset_version_id
         JOIN users cu ON cu.id = i.created_by
         LEFT JOIN users uu ON uu.id = i.updated_by
         LEFT JOIN users du ON du.id = i.deleted_by
        WHERE v.dataset_id = $1
        ORDER BY i.created_at ASC`,
      [datasetId],
    );
    return rows.map(toDatasetItem);
  }

  async listDatasetVersionItemsWithDeleted(datasetVersionId: string): Promise<DatasetItem[]> {
    const { rows } = await this.pool.query<DatasetItemRow>(
      `SELECT ${DATASET_ITEM_SELECT} FROM dataset_items i
         JOIN users cu ON cu.id = i.created_by
         LEFT JOIN users uu ON uu.id = i.updated_by
         LEFT JOIN users du ON du.id = i.deleted_by
        WHERE i.dataset_version_id = $1
        ORDER BY i.created_at ASC`,
      [datasetVersionId],
    );
    return rows.map(toDatasetItem);
  }

  async updateDatasetItem(
    datasetId: string,
    itemId: string,
    updatedByUserId: string,
    patch: { input?: unknown; expectedOutput?: unknown; metadata?: Record<string, unknown> | null },
  ): Promise<DatasetItem | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const version = await this.createNextVersion(client, datasetId, updatedByUserId, "Edited item", "minor", { editItem: { itemId, updatedByUserId, patch } });
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM dataset_items WHERE dataset_version_id = $1 AND updated_by = $2 ORDER BY updated_at DESC LIMIT 1`,
        [version.id, updatedByUserId],
      );
      const row = rows[0];
      const result = row ? await this.getDatasetItemWithEmails(client, row.id) : null;
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteDatasetItem(datasetId: string, itemId: string, deletedByUserId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.createNextVersion(client, datasetId, deletedByUserId, "Deleted item", "major", { deleteItem: { itemId, deletedByUserId } });
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /** Publica una sesión de edición como UNA versión (ADR-041): clona los items activos, aplica
   * ediciones, convierte las bajas en tombstones y añade las altas, todo en una transacción. */
  async commitDatasetChanges(
    datasetId: string,
    userId: string,
    changes: {
      add: Array<{ input: unknown; expectedOutput: unknown; metadata: Record<string, unknown> | null }>;
      update: Array<{ id: string; patch: { input?: unknown; expectedOutput?: unknown; metadata?: Record<string, unknown> | null } }>;
      remove: string[];
    },
  ): Promise<DatasetVersion> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // serializa commits concurrentes del mismo dataset: el segundo ve la versión que dejó el primero
      await client.query(`SELECT 1 FROM datasets WHERE id = $1 FOR UPDATE`, [datasetId]);
      const { rows: latestRows } = await client.query<{ id: string }>(
        `SELECT id FROM dataset_versions WHERE dataset_id = $1 ORDER BY major DESC, minor DESC LIMIT 1`,
        [datasetId],
      );
      const latest = latestRows[0];
      if (!latest) throw new ValidationError("dataset has no versions");

      const removed = new Set(changes.remove);
      const updates = changes.update.filter((u) => !removed.has(u.id));
      const touched = [...new Set([...changes.remove, ...updates.map((u) => u.id)])];
      if (touched.length > 0) {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM dataset_items WHERE dataset_version_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])`,
          [latest.id, touched],
        );
        if (rows.length !== touched.length) {
          throw new ValidationError("some items changed since you loaded them — reload and retry", { items: "stale item id" });
        }
      }

      const counts = { added: changes.add.length, edited: updates.length, removed: removed.size };
      const version = await this.createNextVersion(client, datasetId, userId, describeChanges(counts), bumpForChanges(counts), {
        skipClone: true,
      });
      const removedIds = [...removed];
      // supervivientes tal cual (los borrados salen como tombstone más abajo)
      await client.query(
        `INSERT INTO dataset_items (dataset_version_id, origin_item_id, input, expected_output, metadata, created_by, created_at, updated_by, updated_at)
         SELECT $1, origin_item_id, input, expected_output, metadata, created_by, created_at, updated_by, updated_at
           FROM dataset_items WHERE dataset_version_id = $2 AND deleted_at IS NULL AND NOT (id = ANY($3::uuid[]))`,
        [version.id, latest.id, removedIds],
      );
      if (removedIds.length > 0) {
        await client.query(
          `INSERT INTO dataset_items (dataset_version_id, origin_item_id, input, expected_output, metadata, created_by, created_at, deleted_by, deleted_at)
           SELECT $1, origin_item_id, input, expected_output, metadata, created_by, created_at, $3, now()
             FROM dataset_items WHERE id = ANY($2::uuid[])`,
          [version.id, removedIds, userId],
        );
      }
      for (const { id, patch } of updates) {
        await client.query(
          `UPDATE dataset_items SET
              input = CASE WHEN $3::boolean THEN $4::jsonb ELSE input END,
              expected_output = CASE WHEN $5::boolean THEN $6::jsonb ELSE expected_output END,
              metadata = CASE WHEN $7::boolean THEN ${keepPromotedFrom("$8::jsonb", "metadata")} ELSE metadata END,
              updated_by = $9, updated_at = now()
            WHERE dataset_version_id = $1 AND deleted_at IS NULL
              AND origin_item_id = (SELECT origin_item_id FROM dataset_items WHERE id = $2)`,
          [
            version.id,
            id,
            patch.input !== undefined,
            JSON.stringify(patch.input ?? null),
            patch.expectedOutput !== undefined,
            JSON.stringify(patch.expectedOutput ?? null),
            patch.metadata !== undefined,
            patch.metadata == null ? null : JSON.stringify(patch.metadata),
            userId,
          ],
        );
      }
      for (const item of changes.add) {
        const itemId = randomUUID();
        await client.query(
          `INSERT INTO dataset_items (id, origin_item_id, dataset_version_id, input, expected_output, metadata, created_by, created_at)
           VALUES ($1, $1, $2, $3, $4, $5, $6, clock_timestamp())`,
          [itemId, version.id, JSON.stringify(item.input), item.expectedOutput === undefined ? null : JSON.stringify(item.expectedOutput), item.metadata ? JSON.stringify(item.metadata) : null, userId],
        );
      }
      await client.query("COMMIT");
      const created = await this.getLatestDatasetVersion(datasetId);
      if (!created) throw new Error("failed to read back dataset version");
      return created;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async createDatasetRun(id: string, datasetId: string, datasetVersionId: string, name: string, itemCount: number, status: DatasetRunStatus): Promise<DatasetRun> {
    const { rows } = await this.pool.query<{ id: string; dataset_id: string; dataset_version_id: string; major: number; minor: number; name: string; item_count: number; status: DatasetRunStatus; created_at: string }>(
      `INSERT INTO dataset_runs (id, dataset_id, dataset_version_id, name, item_count, status) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING dataset_runs.id, dataset_runs.dataset_id, dataset_runs.dataset_version_id, dataset_runs.name, dataset_runs.item_count, dataset_runs.status, dataset_runs.created_at,
                 (SELECT major FROM dataset_versions WHERE id = $3) AS major,
                 (SELECT minor FROM dataset_versions WHERE id = $3) AS minor`,
      [id, datasetId, datasetVersionId, name, itemCount, status],
    );
    const row = rows[0];
    if (!row) throw new Error("failed to insert dataset run");
    return toDatasetRun(row);
  }

  async updateDatasetRunProgress(runId: string, itemCount: number, completed: boolean): Promise<DatasetRun | null> {
    const { rowCount } = await this.pool.query(
      `UPDATE dataset_runs SET item_count = GREATEST(item_count, $2), status = CASE WHEN $3 THEN 'completed' ELSE status END WHERE id = $1`,
      [runId, itemCount, completed],
    );
    return rowCount ? this.getDatasetRun(runId) : null;
  }

  async listDatasetRuns(datasetId: string): Promise<DatasetRun[]> {
    const { rows } = await this.pool.query<{ id: string; dataset_id: string; dataset_version_id: string; major: number; minor: number; name: string; item_count: number; status: DatasetRunStatus; created_at: string }>(
      `SELECT r.id, r.dataset_id, r.dataset_version_id, v.major, v.minor, r.name, r.item_count, r.status, r.created_at
         FROM dataset_runs r JOIN dataset_versions v ON v.id = r.dataset_version_id
        WHERE r.dataset_id = $1
        ORDER BY r.created_at DESC`,
      [datasetId],
    );
    return rows.map(toDatasetRun);
  }

  async getDatasetRun(runId: string): Promise<DatasetRun | null> {
    const { rows } = await this.pool.query<{ id: string; dataset_id: string; dataset_version_id: string; major: number; minor: number; name: string; item_count: number; status: DatasetRunStatus; created_at: string }>(
      `SELECT r.id, r.dataset_id, r.dataset_version_id, v.major, v.minor, r.name, r.item_count, r.status, r.created_at
         FROM dataset_runs r JOIN dataset_versions v ON v.id = r.dataset_version_id
        WHERE r.id = $1`,
      [runId],
    );
    return rows[0] ? toDatasetRun(rows[0]) : null;
  }

  async listRunsForExperiment(experimentId: string): Promise<DatasetRunWithDataset[]> {
    const { rows } = await this.pool.query<{
      id: string;
      dataset_id: string;
      dataset_version_id: string;
      major: number;
      minor: number;
      name: string;
      item_count: number;
      status: DatasetRunStatus;
      created_at: string;
      dataset_name: string;
    }>(
      `SELECT r.id, r.dataset_id, r.dataset_version_id, v.major, v.minor, r.name, r.item_count, r.status, r.created_at, d.name AS dataset_name
         FROM dataset_runs r
         JOIN dataset_versions v ON v.id = r.dataset_version_id
         JOIN datasets d ON d.id = r.dataset_id
        WHERE d.experiment_id = $1
        ORDER BY r.created_at DESC`,
      [experimentId],
    );
    return rows.map((row) => ({ ...toDatasetRun(row), datasetName: row.dataset_name }));
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

function toMetricReport(row: { id: string; experiment_id: string; name: string; created_at: string; updated_at: string }): MetricReport {
  return { id: row.id, experimentId: row.experiment_id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at };
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

function toMember(row: { user_id: string; email: string; name: string | null; role: OrgRole | ExperimentRole; source: Member["source"] }): Member {
  return { userId: row.user_id, email: row.email, name: row.name, role: row.role, source: row.source };
}

function toDataset(row: { id: string; experiment_id: string; name: string; created_at: string }): Dataset {
  return { id: row.id, experimentId: row.experiment_id, name: row.name, createdAt: row.created_at };
}

function toDatasetVersion(row: {
  id: string;
  dataset_id: string;
  major: number;
  minor: number;
  note: string | null;
  created_by: string;
  created_by_email: string;
  created_at: string;
}): DatasetVersion {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    major: row.major,
    minor: row.minor,
    note: row.note,
    createdBy: row.created_by,
    createdByEmail: row.created_by_email,
    createdAt: row.created_at,
  };
}

function toDatasetItem(row: DatasetItemRow): DatasetItem {
  return {
    id: row.id,
    originItemId: row.origin_item_id,
    datasetVersionId: row.dataset_version_id,
    input: row.input,
    expectedOutput: row.expected_output,
    metadata: (row.metadata ?? null) as Record<string, unknown> | null,
    createdBy: row.created_by,
    createdByEmail: row.created_by_email,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedByEmail: row.updated_by_email,
    updatedAt: row.updated_at,
    deletedBy: row.deleted_by,
    deletedByEmail: row.deleted_by_email,
    deletedAt: row.deleted_at,
  };
}

function toDatasetRun(row: { id: string; dataset_id: string; dataset_version_id: string; major: number; minor: number; name: string; item_count: number; status: DatasetRunStatus; created_at: string }): DatasetRun {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    datasetVersionId: row.dataset_version_id,
    versionMajor: row.major,
    versionMinor: row.minor,
    name: row.name,
    itemCount: row.item_count,
    status: row.status,
    createdAt: row.created_at,
  };
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
