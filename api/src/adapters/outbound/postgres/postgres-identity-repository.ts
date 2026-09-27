import type { Pool } from "pg";
import { randomBytes, createHash } from "node:crypto";
import type { IdentityRepository } from "@/application/ports/identity-repository";
import type {
  ApiKey,
  Experiment,
  ExperimentAccess,
  ExperimentRole,
  Organization,
  PendingInvitationTarget,
  User,
} from "@/domain/identity";

const API_KEY_PREFIX = "mtk_";

function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
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
      const { rows } = await client.query<{ id: string; name: string }>(
        `INSERT INTO organizations (name) VALUES ($1) RETURNING id, name`,
        [name],
      );
      const organization = rows[0];
      if (!organization) throw new Error("failed to insert organization");
      await client.query(
        `INSERT INTO org_memberships (organization_id, user_id, role) VALUES ($1, $2, 'org_admin')`,
        [organization.id, ownerUserId],
      );
      await client.query("COMMIT");
      return organization;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getOrganization(organizationId: string): Promise<Organization | null> {
    const { rows } = await this.pool.query<{ id: string; name: string }>(`SELECT id, name FROM organizations WHERE id = $1`, [organizationId]);
    return rows[0] ?? null;
  }

  async listOrganizationsForUser(userId: string): Promise<Organization[]> {
    const { rows } = await this.pool.query<{ id: string; name: string }>(
      `SELECT o.id, o.name
         FROM organizations o
         JOIN org_memberships m ON m.organization_id = o.id
        WHERE m.user_id = $1
        ORDER BY o.name`,
      [userId],
    );
    return rows;
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

  async createExperiment(organizationId: string, name: string, serviceName: string): Promise<Experiment> {
    const { rows } = await this.pool.query<{ id: string; organization_id: string; name: string; service_name: string }>(
      `INSERT INTO experiments (organization_id, name, service_name) VALUES ($1, $2, $3)
       RETURNING id, organization_id, name, service_name`,
      [organizationId, name, serviceName],
    );
    const row = rows[0];
    if (!row) throw new Error("failed to insert experiment");
    return toExperiment(row);
  }

  async getExperiment(experimentId: string): Promise<Experiment | null> {
    const { rows } = await this.pool.query<{ id: string; organization_id: string; name: string; service_name: string }>(
      `SELECT id, organization_id, name, service_name FROM experiments WHERE id = $1`,
      [experimentId],
    );
    return rows[0] ? toExperiment(rows[0]) : null;
  }

  async listExperimentsForUser(userId: string): Promise<Experiment[]> {
    const { rows } = await this.pool.query<{ id: string; organization_id: string; name: string; service_name: string }>(
      `SELECT DISTINCT e.id, e.organization_id, e.name, e.service_name
         FROM experiments e
         LEFT JOIN experiment_memberships em ON em.experiment_id = e.id AND em.user_id = $1
         LEFT JOIN org_memberships om ON om.organization_id = e.organization_id AND om.user_id = $1
        WHERE em.user_id IS NOT NULL OR om.user_id IS NOT NULL
        ORDER BY e.name`,
      [userId],
    );
    return rows.map(toExperiment);
  }

  async addExperimentMember(experimentId: string, userId: string, role: ExperimentRole): Promise<void> {
    await this.pool.query(
      `INSERT INTO experiment_memberships (experiment_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (experiment_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [experimentId, userId, role],
    );
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

  async resolveApiKey(plaintext: string): Promise<{ experimentId: string; serviceName: string } | null> {
    const { rows } = await this.pool.query<{ id: string; experiment_id: string; service_name: string }>(
      `SELECT k.id, k.experiment_id, e.service_name
         FROM api_keys k
         JOIN experiments e ON e.id = k.experiment_id
        WHERE k.key_hash = $1 AND k.revoked_at IS NULL`,
      [hashApiKey(plaintext)],
    );
    const row = rows[0];
    if (!row) return null;
    // no bloqueante: no hace falta esperar a que se confirme para responder al agente
    void this.pool.query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [row.id]);
    return { experimentId: row.experiment_id, serviceName: row.service_name };
  }
}

function toApiKey(row: { id: string; experiment_id: string; key_prefix: string; created_at: string; last_used_at: string | null }): ApiKey {
  return { id: row.id, experimentId: row.experiment_id, keyPrefix: row.key_prefix, createdAt: row.created_at, lastUsedAt: row.last_used_at };
}

function toExperiment(row: { id: string; organization_id: string; name: string; service_name: string }): Experiment {
  return { id: row.id, organizationId: row.organization_id, name: row.name, serviceName: row.service_name };
}
