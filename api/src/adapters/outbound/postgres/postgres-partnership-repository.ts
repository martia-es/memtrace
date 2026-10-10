import type { Pool } from "pg";
import type { PartnershipRepository } from "@/application/ports/partnership-repository";
import type { NewPartnerGrant, PartnerClient, PartnerGrant, Partnership } from "@/domain/partnership";

/**
 * Un grant solo cuenta mientras la relación y el grant estén vigentes y la persona siga siendo miembro de la organización
 * partner desde antes de concederlo: dar de baja a alguien en la consultora le quita el acceso a todos los clientes y, si la
 * vuelven a dar de alta, el grant no resucita (ADR-091). El mismo predicado se usa en `PostgresIdentityRepository`.
 */
const EFFECTIVE = `g.revoked_at IS NULL AND p.revoked_at IS NULL
  AND EXISTS (SELECT 1 FROM org_memberships pm WHERE pm.organization_id = p.partner_organization_id AND pm.user_id = g.user_id AND pm.created_at <= g.created_at)`;

interface GrantRow {
  id: string;
  partnership_id: string;
  user_id: string;
  email: string;
  name: string | null;
  role: string;
  experiment_id: string | null;
  granted_by: string;
  created_at: Date | string;
}

const iso = (value: Date | string) => (value instanceof Date ? value.toISOString() : value);
const toGrant = (r: GrantRow): PartnerGrant => ({
  id: r.id,
  partnershipId: r.partnership_id,
  userId: r.user_id,
  userEmail: r.email,
  userName: r.name,
  role: r.role,
  experimentId: r.experiment_id,
  grantedBy: r.granted_by,
  createdAt: iso(r.created_at),
});

const GRANT_COLUMNS = `g.id, g.partnership_id, g.user_id, u.email, u.name, g.role, g.experiment_id, g.granted_by, g.created_at`;

export class PostgresPartnershipRepository implements PartnershipRepository {
  constructor(private readonly pool: Pool) {}

  async organizationName(organizationId: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ name: string }>(`SELECT name FROM organizations WHERE id = $1`, [organizationId]);
    return rows[0]?.name ?? null;
  }

  async listForClient(clientOrganizationId: string): Promise<Partnership[]> {
    const { rows } = await this.pool.query<{ id: string; client_organization_id: string; partner_organization_id: string; name: string; created_by: string; created_at: Date | string }>(
      `SELECT p.id, p.client_organization_id, p.partner_organization_id, o.name, p.created_by, p.created_at
         FROM organization_partnerships p JOIN organizations o ON o.id = p.partner_organization_id
        WHERE p.client_organization_id = $1 AND p.revoked_at IS NULL
        ORDER BY o.name`,
      [clientOrganizationId],
    );
    return Promise.all(rows.map((r) => this.hydrate(r)));
  }

  async getActive(clientOrganizationId: string, partnershipId: string): Promise<Partnership | null> {
    const { rows } = await this.pool.query<{ id: string; client_organization_id: string; partner_organization_id: string; name: string; created_by: string; created_at: Date | string }>(
      `SELECT p.id, p.client_organization_id, p.partner_organization_id, o.name, p.created_by, p.created_at
         FROM organization_partnerships p JOIN organizations o ON o.id = p.partner_organization_id
        WHERE p.id = $1 AND p.client_organization_id = $2 AND p.revoked_at IS NULL`,
      [partnershipId, clientOrganizationId],
    );
    return rows[0] ? this.hydrate(rows[0]) : null;
  }

  private async hydrate(r: { id: string; client_organization_id: string; partner_organization_id: string; name: string; created_by: string; created_at: Date | string }): Promise<Partnership> {
    const { rows } = await this.pool.query<GrantRow>(
      `SELECT ${GRANT_COLUMNS}
         FROM partner_grants g
         JOIN organization_partnerships p ON p.id = g.partnership_id
         JOIN users u ON u.id = g.user_id
        WHERE g.partnership_id = $1 AND ${EFFECTIVE}
        ORDER BY u.email, g.created_at`,
      [r.id],
    );
    return {
      id: r.id,
      clientOrganizationId: r.client_organization_id,
      partnerOrganizationId: r.partner_organization_id,
      partnerOrganizationName: r.name,
      createdBy: r.created_by,
      createdAt: iso(r.created_at),
      grants: rows.map(toGrant),
    };
  }

  async create(clientOrganizationId: string, partnerOrganizationId: string, createdBy: string): Promise<{ id: string } | null> {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO organization_partnerships (client_organization_id, partner_organization_id, created_by) VALUES ($1, $2, $3)
       ON CONFLICT (client_organization_id, partner_organization_id) WHERE revoked_at IS NULL DO NOTHING
       RETURNING id`,
      [clientOrganizationId, partnerOrganizationId, createdBy],
    );
    return rows[0] ?? null;
  }

  async revoke(clientOrganizationId: string, partnershipId: string, revokedBy: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rowCount } = await client.query(
        `UPDATE organization_partnerships SET revoked_at = now(), revoked_by = $3
          WHERE id = $1 AND client_organization_id = $2 AND revoked_at IS NULL`,
        [partnershipId, clientOrganizationId, revokedBy],
      );
      if (rowCount) await client.query(`UPDATE partner_grants SET revoked_at = now(), revoked_by = $2 WHERE partnership_id = $1 AND revoked_at IS NULL`, [partnershipId, revokedBy]);
      await client.query("COMMIT");
      return Boolean(rowCount);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findPartnerMember(partnerOrganizationId: string, email: string): Promise<{ id: string } | null> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT u.id FROM users u JOIN org_memberships m ON m.user_id = u.id
        WHERE m.organization_id = $1 AND lower(u.email) = lower($2) LIMIT 1`,
      [partnerOrganizationId, email],
    );
    return rows[0] ?? null;
  }

  async experimentBelongsTo(experimentId: string, organizationId: string): Promise<boolean> {
    const { rows } = await this.pool.query(`SELECT 1 FROM experiments WHERE id = $1 AND organization_id = $2`, [experimentId, organizationId]);
    return rows.length > 0;
  }

  async experimentRoleNames(): Promise<string[]> {
    const { rows } = await this.pool.query<{ name: string }>(`SELECT name FROM roles WHERE scope = 'experiment' ORDER BY name`);
    return rows.map((r) => r.name);
  }

  async grant(partnershipId: string, userId: string, input: Pick<NewPartnerGrant, "role" | "experimentId">, grantedBy: string): Promise<PartnerGrant> {
    const { rows } = await this.pool.query<GrantRow>(
      `WITH upserted AS (
         INSERT INTO partner_grants (partnership_id, user_id, role, experiment_id, granted_by) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (partnership_id, user_id, COALESCE(experiment_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE revoked_at IS NULL
         DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, created_at = now()
         RETURNING id, partnership_id, user_id, role, experiment_id, granted_by, created_at
       )
       SELECT g.id, g.partnership_id, g.user_id, u.email, u.name, g.role, g.experiment_id, g.granted_by, g.created_at
         FROM upserted g JOIN users u ON u.id = g.user_id`,
      [partnershipId, userId, input.role, input.experimentId, grantedBy],
    );
    return toGrant(rows[0]!);
  }

  async revokeGrant(partnershipId: string, grantId: string, revokedBy: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE partner_grants SET revoked_at = now(), revoked_by = $3 WHERE id = $1 AND partnership_id = $2 AND revoked_at IS NULL`,
      [grantId, partnershipId, revokedBy],
    );
    return Boolean(rowCount);
  }

  async listClientsForUser(userId: string): Promise<PartnerClient[]> {
    const { rows } = await this.pool.query<{ partnership_id: string; organization_id: string; organization_name: string; experiment_id: string; experiment_name: string; role: string }>(
      `SELECT p.id AS partnership_id, c.id AS organization_id, c.name AS organization_name, e.id AS experiment_id, e.name AS experiment_name, g.role
         FROM partner_grants g
         JOIN organization_partnerships p ON p.id = g.partnership_id
         JOIN organizations c ON c.id = p.client_organization_id
         JOIN experiments e ON e.organization_id = c.id AND (g.experiment_id IS NULL OR g.experiment_id = e.id)
        WHERE g.user_id = $1 AND ${EFFECTIVE}
        ORDER BY c.name, e.name`,
      [userId],
    );
    const byClient = new Map<string, PartnerClient>();
    for (const r of rows) {
      const client = byClient.get(r.partnership_id) ?? { organizationId: r.organization_id, organizationName: r.organization_name, partnershipId: r.partnership_id, experiments: [] };
      if (!client.experiments.some((e) => e.id === r.experiment_id)) client.experiments.push({ id: r.experiment_id, name: r.experiment_name, role: r.role });
      byClient.set(r.partnership_id, client);
    }
    return [...byClient.values()];
  }
}
