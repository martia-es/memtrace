import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { ExternalIdentityRepository, MappedOrganization, NewScimUser, ScimToken, ScimUserMembership } from "@/application/ports/external-identity-repository";
import { ValidationError } from "@/domain/errors";
import type { ExternalGrant, ExternalMapping, ExternalSource } from "@/domain/external-access";
import type { ScimGroup, ScimUser } from "@/domain/scim";

const SCIM_TOKEN_PREFIX = "mtscim_";
const hashToken = (plaintext: string) => createHash("sha256").update(plaintext).digest("hex");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const onlyUuids = (ids: string[]) => ids.filter((id) => UUID.test(id));

interface MappingRow {
  id: string;
  organization_id: string;
  external_group: string;
  experiment_id: string | null;
  role: string;
  created_at: string;
}
interface ScimUserRow {
  id: string;
  organization_id: string;
  user_name: string;
  external_id: string | null;
  display_name: string | null;
  active: boolean;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}
interface ScimGroupRow {
  id: string;
  organization_id: string;
  display_name: string;
  external_id: string | null;
  member_ids: string[] | null;
  created_at: string;
  updated_at: string;
}

const toMapping = (r: MappingRow): ExternalMapping => ({
  id: r.id,
  organizationId: r.organization_id,
  externalGroup: r.external_group,
  experimentId: r.experiment_id,
  role: r.role,
  createdAt: new Date(r.created_at).toISOString(),
});
const toScimUser = (r: ScimUserRow): ScimUser => ({
  id: r.id,
  organizationId: r.organization_id,
  userName: r.user_name,
  externalId: r.external_id,
  displayName: r.display_name,
  active: r.active,
  userId: r.user_id,
  createdAt: new Date(r.created_at).toISOString(),
  updatedAt: new Date(r.updated_at).toISOString(),
});
const toScimGroup = (r: ScimGroupRow): ScimGroup => ({
  id: r.id,
  organizationId: r.organization_id,
  displayName: r.display_name,
  externalId: r.external_id,
  memberIds: r.member_ids ?? [],
  createdAt: new Date(r.created_at).toISOString(),
  updatedAt: new Date(r.updated_at).toISOString(),
});

const GROUP_SELECT = `SELECT g.id, g.organization_id, g.display_name, g.external_id, g.created_at, g.updated_at,
       COALESCE(array_agg(m.scim_user_id) FILTER (WHERE m.scim_user_id IS NOT NULL), '{}') AS member_ids
  FROM scim_groups g LEFT JOIN scim_group_members m ON m.group_id = g.id`;

const isUniqueViolation = (error: unknown) => (error as { code?: string }).code === "23505";

export class PostgresExternalIdentityRepository implements ExternalIdentityRepository {
  constructor(private readonly pool: Pool) {}

  // ---- ajustes y mapeos ----

  async getGroupsClaim(organizationId: string): Promise<string> {
    const { rows } = await this.pool.query<{ groups_claim: string }>(`SELECT groups_claim FROM organization_idp_settings WHERE organization_id = $1`, [organizationId]);
    return rows[0]?.groups_claim ?? "groups";
  }

  async setGroupsClaim(organizationId: string, claim: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO organization_idp_settings (organization_id, groups_claim) VALUES ($1, $2)
       ON CONFLICT (organization_id) DO UPDATE SET groups_claim = EXCLUDED.groups_claim, updated_at = now()`,
      [organizationId, claim],
    );
  }

  async listMappings(organizationId: string): Promise<ExternalMapping[]> {
    const { rows } = await this.pool.query<MappingRow>(
      `SELECT id, organization_id, external_group, experiment_id, role, created_at FROM external_mappings WHERE organization_id = $1 ORDER BY external_group, role`,
      [organizationId],
    );
    return rows.map(toMapping);
  }

  async createMapping(organizationId: string, input: { externalGroup: string; experimentId: string | null; role: string }): Promise<ExternalMapping> {
    const role = await this.pool.query<{ scope: string }>(`SELECT scope FROM roles WHERE name = $1`, [input.role]);
    const scope = role.rows[0]?.scope;
    if (!scope) throw new ValidationError("Invalid mapping", { role: "unknown role" });
    if (input.experimentId === null && scope !== "organization") throw new ValidationError("Invalid mapping", { role: "is not an organization role" });
    if (input.experimentId !== null) {
      if (scope !== "experiment") throw new ValidationError("Invalid mapping", { role: "is not an experiment role" });
      const exp = UUID.test(input.experimentId)
        ? await this.pool.query(`SELECT 1 FROM experiments WHERE id = $1 AND organization_id = $2`, [input.experimentId, organizationId])
        : { rowCount: 0 };
      if (!exp.rowCount) throw new ValidationError("Invalid mapping", { experimentId: "is not an experiment of this organization" });
    }
    try {
      const { rows } = await this.pool.query<MappingRow>(
        `INSERT INTO external_mappings (organization_id, external_group, experiment_id, role) VALUES ($1, $2, $3, $4)
         RETURNING id, organization_id, external_group, experiment_id, role, created_at`,
        [organizationId, input.externalGroup, input.experimentId, input.role],
      );
      return toMapping(rows[0]!);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ValidationError("Invalid mapping", { externalGroup: "this group already gives that role there" });
      throw error;
    }
  }

  async deleteMapping(organizationId: string, mappingId: string): Promise<boolean> {
    if (!UUID.test(mappingId)) return false;
    const result = await this.pool.query(`DELETE FROM external_mappings WHERE id = $1 AND organization_id = $2`, [mappingId, organizationId]);
    return (result.rowCount ?? 0) > 0;
  }

  async listMappedOrganizations(): Promise<MappedOrganization[]> {
    const { rows } = await this.pool.query<MappingRow & { groups_claim: string | null }>(
      `SELECT m.id, m.organization_id, m.external_group, m.experiment_id, m.role, m.created_at, s.groups_claim
         FROM external_mappings m LEFT JOIN organization_idp_settings s ON s.organization_id = m.organization_id
        ORDER BY m.organization_id`,
    );
    const byOrg = new Map<string, MappedOrganization>();
    for (const r of rows) {
      const entry = byOrg.get(r.organization_id) ?? { organizationId: r.organization_id, groupsClaim: r.groups_claim ?? "groups", mappings: [] };
      entry.mappings.push(toMapping(r));
      byOrg.set(r.organization_id, entry);
    }
    return [...byOrg.values()];
  }

  async roleWeights(): Promise<Map<string, number>> {
    const { rows } = await this.pool.query<{ role_name: string; n: number }>(`SELECT role_name, count(*)::int AS n FROM role_permissions GROUP BY role_name`);
    return new Map(rows.map((r) => [r.role_name, r.n]));
  }

  // ---- conciliación ----

  async reconcile(userId: string, organizationId: string, source: ExternalSource, grants: ExternalGrant[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.reconcileIn(client, userId, organizationId, source, grants);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async reconcileIn(client: PoolClient, userId: string, organizationId: string, source: ExternalSource, grants: ExternalGrant[]): Promise<void> {
    const orgGrant = grants.find((g) => g.experimentId === null);
    const experimentGrants = grants.filter((g): g is ExternalGrant & { experimentId: string } => g.experimentId !== null);

    // Una membresía manual manda siempre: el `WHERE` impide que una externa la pise.
    if (orgGrant) {
      await client.query(
        `INSERT INTO org_memberships (organization_id, user_id, role, source) VALUES ($1, $2, $3, $4)
         ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role, source = EXCLUDED.source
           WHERE org_memberships.source <> 'manual'`,
        [organizationId, userId, orgGrant.role, source],
      );
    }
    for (const g of experimentGrants) {
      await client.query(
        `INSERT INTO experiment_memberships (experiment_id, user_id, role, source)
         SELECT e.id, $2, $3, $4 FROM experiments e WHERE e.id = $1 AND e.organization_id = $5
         ON CONFLICT (experiment_id, user_id) DO UPDATE SET role = EXCLUDED.role, source = EXCLUDED.source
           WHERE experiment_memberships.source <> 'manual'`,
        [g.experimentId, userId, g.role, source, organizationId],
      );
    }

    // Lo que esta fuente había dado y ya no corresponde. Nunca se quita el último org_admin de una organización.
    await client.query(
      `DELETE FROM experiment_memberships em USING experiments e
        WHERE e.id = em.experiment_id AND e.organization_id = $1 AND em.user_id = $2 AND em.source = $3
          AND NOT (em.experiment_id = ANY($4::uuid[]))`,
      [organizationId, userId, source, experimentGrants.map((g) => g.experimentId)],
    );
    if (!orgGrant) {
      await client.query(
        `DELETE FROM org_memberships om
          WHERE om.organization_id = $1 AND om.user_id = $2 AND om.source = $3
            AND EXISTS (SELECT 1 FROM org_memberships o2 WHERE o2.organization_id = om.organization_id AND o2.user_id <> om.user_id AND o2.role = 'org_admin')`,
        [organizationId, userId, source],
      );
    }
  }

  async purgeExternal(organizationId: string, source: ExternalSource): Promise<void> {
    await this.pool.query(
      `DELETE FROM experiment_memberships em USING experiments e WHERE e.id = em.experiment_id AND e.organization_id = $1 AND em.source = $2`,
      [organizationId, source],
    );
    // un org_admin externo se conserva si la organización se quedaría sin ninguno
    await this.pool.query(
      `DELETE FROM org_memberships om
        WHERE om.organization_id = $1 AND om.source = $2
          AND EXISTS (SELECT 1 FROM org_memberships o2 WHERE o2.organization_id = om.organization_id AND o2.role = 'org_admin' AND o2.source <> $2)`,
      [organizationId, source],
    );
  }

  // ---- tokens SCIM ----

  async createScimToken(organizationId: string, createdBy: string): Promise<{ token: ScimToken; plaintext: string }> {
    const plaintext = `${SCIM_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const { rows } = await this.pool.query<{ id: string; created_at: string; last_used_at: string | null }>(
      `INSERT INTO scim_tokens (organization_id, token_hash, token_prefix, created_by) VALUES ($1, $2, $3, $4) RETURNING id, created_at, last_used_at`,
      [organizationId, hashToken(plaintext), plaintext.slice(0, 12), createdBy],
    );
    const row = rows[0]!;
    return {
      token: { id: row.id, organizationId, tokenPrefix: plaintext.slice(0, 12), createdAt: new Date(row.created_at).toISOString(), lastUsedAt: null },
      plaintext,
    };
  }

  async listScimTokens(organizationId: string): Promise<ScimToken[]> {
    const { rows } = await this.pool.query<{ id: string; token_prefix: string; created_at: string; last_used_at: string | null }>(
      `SELECT id, token_prefix, created_at, last_used_at FROM scim_tokens WHERE organization_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`,
      [organizationId],
    );
    return rows.map((r) => ({
      id: r.id,
      organizationId,
      tokenPrefix: r.token_prefix,
      createdAt: new Date(r.created_at).toISOString(),
      lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
    }));
  }

  async revokeScimToken(organizationId: string, tokenId: string): Promise<boolean> {
    if (!UUID.test(tokenId)) return false;
    const result = await this.pool.query(`UPDATE scim_tokens SET revoked_at = now() WHERE id = $1 AND organization_id = $2 AND revoked_at IS NULL`, [tokenId, organizationId]);
    return (result.rowCount ?? 0) > 0;
  }

  async resolveScimToken(plaintext: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ id: string; organization_id: string }>(
      `SELECT id, organization_id FROM scim_tokens WHERE token_hash = $1 AND revoked_at IS NULL`,
      [hashToken(plaintext)],
    );
    const row = rows[0];
    if (!row) return null;
    void this.pool.query(`UPDATE scim_tokens SET last_used_at = now() WHERE id = $1`, [row.id]);
    return row.organization_id;
  }

  // ---- usuarios SCIM ----

  async listScimUsers(organizationId: string, query: { userName?: string; startIndex: number; count: number }): Promise<{ total: number; items: ScimUser[] }> {
    const where = `organization_id = $1 AND ($2::text IS NULL OR lower(user_name) = lower($2))`;
    const params = [organizationId, query.userName ?? null];
    const [{ rows }, count] = await Promise.all([
      this.pool.query<ScimUserRow>(`SELECT * FROM scim_users WHERE ${where} ORDER BY created_at, id OFFSET $3 LIMIT $4`, [...params, Math.max(query.startIndex - 1, 0), query.count]),
      this.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM scim_users WHERE ${where}`, params),
    ]);
    return { total: count.rows[0]!.n, items: rows.map(toScimUser) };
  }

  async getScimUser(organizationId: string, id: string): Promise<ScimUser | null> {
    if (!UUID.test(id)) return null;
    const { rows } = await this.pool.query<ScimUserRow>(`SELECT * FROM scim_users WHERE id = $1 AND organization_id = $2`, [id, organizationId]);
    return rows[0] ? toScimUser(rows[0]) : null;
  }

  async createScimUser(organizationId: string, input: NewScimUser): Promise<ScimUser | null> {
    try {
      const { rows } = await this.pool.query<ScimUserRow>(
        `INSERT INTO scim_users (organization_id, user_name, external_id, display_name, active, user_id)
         VALUES ($1, $2, $3, $4, $5, (SELECT id FROM users WHERE lower(email) = lower($2)))
         RETURNING *`,
        [organizationId, input.userName, input.externalId, input.displayName, input.active],
      );
      return toScimUser(rows[0]!);
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  async updateScimUser(organizationId: string, id: string, patch: Partial<NewScimUser>): Promise<ScimUser | null> {
    if (!UUID.test(id)) return null;
    const has = (k: keyof NewScimUser) => k in patch;
    const { rows } = await this.pool.query<ScimUserRow>(
      `UPDATE scim_users SET
          user_name    = CASE WHEN $3 THEN $4 ELSE user_name END,
          external_id  = CASE WHEN $5 THEN $6 ELSE external_id END,
          display_name = CASE WHEN $7 THEN $8 ELSE display_name END,
          active       = CASE WHEN $9 THEN $10 ELSE active END,
          user_id      = CASE WHEN $3 THEN (SELECT id FROM users WHERE lower(email) = lower($4)) ELSE user_id END,
          updated_at   = now()
        WHERE id = $1 AND organization_id = $2
        RETURNING *`,
      [id, organizationId, has("userName"), patch.userName ?? null, has("externalId"), patch.externalId ?? null, has("displayName"), patch.displayName ?? null, has("active"), patch.active ?? null],
    );
    return rows[0] ? toScimUser(rows[0]) : null;
  }

  async deleteScimUser(organizationId: string, id: string): Promise<ScimUser | null> {
    if (!UUID.test(id)) return null;
    const { rows } = await this.pool.query<ScimUserRow>(`DELETE FROM scim_users WHERE id = $1 AND organization_id = $2 RETURNING *`, [id, organizationId]);
    return rows[0] ? toScimUser(rows[0]) : null;
  }

  async linkScimUsersByEmail(userId: string, email: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ organization_id: string }>(
      `UPDATE scim_users SET user_id = $1, updated_at = now() WHERE user_id IS NULL AND lower(user_name) = lower($2) RETURNING organization_id`,
      [userId, email],
    );
    return rows.map((r) => r.organization_id);
  }

  // ---- grupos SCIM ----

  async listScimGroups(organizationId: string, query: { displayName?: string; startIndex: number; count: number }): Promise<{ total: number; items: ScimGroup[] }> {
    const where = `g.organization_id = $1 AND ($2::text IS NULL OR g.display_name = $2)`;
    const params = [organizationId, query.displayName ?? null];
    const [{ rows }, count] = await Promise.all([
      this.pool.query<ScimGroupRow>(`${GROUP_SELECT} WHERE ${where} GROUP BY g.id ORDER BY g.created_at, g.id OFFSET $3 LIMIT $4`, [...params, Math.max(query.startIndex - 1, 0), query.count]),
      this.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM scim_groups g WHERE ${where}`, params),
    ]);
    return { total: count.rows[0]!.n, items: rows.map(toScimGroup) };
  }

  async getScimGroup(organizationId: string, id: string): Promise<ScimGroup | null> {
    if (!UUID.test(id)) return null;
    const { rows } = await this.pool.query<ScimGroupRow>(`${GROUP_SELECT} WHERE g.id = $1 AND g.organization_id = $2 GROUP BY g.id`, [id, organizationId]);
    return rows[0] ? toScimGroup(rows[0]) : null;
  }

  async createScimGroup(organizationId: string, input: { displayName: string; externalId: string | null; memberIds: string[] }): Promise<ScimGroup | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO scim_groups (organization_id, display_name, external_id) VALUES ($1, $2, $3) RETURNING id`,
        [organizationId, input.displayName, input.externalId],
      );
      await this.addMembers(client, organizationId, rows[0]!.id, input.memberIds);
      await client.query("COMMIT");
      return this.getScimGroup(organizationId, rows[0]!.id);
    } catch (error) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(error)) return null;
      throw error;
    } finally {
      client.release();
    }
  }

  async updateScimGroup(
    organizationId: string,
    id: string,
    patch: { displayName?: string; externalId?: string | null; add?: string[]; remove?: string[]; replace?: string[] | null },
  ): Promise<ScimGroup | null> {
    if (!UUID.test(id)) return null;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rowCount } = await client.query(
        `UPDATE scim_groups SET display_name = COALESCE($3, display_name), external_id = CASE WHEN $4 THEN $5 ELSE external_id END, updated_at = now()
          WHERE id = $1 AND organization_id = $2`,
        [id, organizationId, patch.displayName ?? null, "externalId" in patch, patch.externalId ?? null],
      );
      if (!rowCount) {
        await client.query("ROLLBACK");
        return null;
      }
      if (patch.replace) await client.query(`DELETE FROM scim_group_members WHERE group_id = $1`, [id]);
      if (patch.remove?.length) await client.query(`DELETE FROM scim_group_members WHERE group_id = $1 AND scim_user_id = ANY($2::uuid[])`, [id, onlyUuids(patch.remove)]);
      await this.addMembers(client, organizationId, id, [...(patch.replace ?? []), ...(patch.add ?? [])]);
      await client.query("COMMIT");
      return this.getScimGroup(organizationId, id);
    } catch (error) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(error)) return null;
      throw error;
    } finally {
      client.release();
    }
  }

  /** Solo entran usuarios de la misma organización: un id ajeno o inexistente se ignora. */
  private async addMembers(client: PoolClient, organizationId: string, groupId: string, scimUserIds: string[]): Promise<void> {
    const ids = onlyUuids(scimUserIds);
    if (!ids.length) return;
    await client.query(
      `INSERT INTO scim_group_members (group_id, scim_user_id)
       SELECT $1, u.id FROM scim_users u WHERE u.organization_id = $2 AND u.id = ANY($3::uuid[])
       ON CONFLICT DO NOTHING`,
      [groupId, organizationId, ids],
    );
  }

  async deleteScimGroup(organizationId: string, id: string): Promise<ScimGroup | null> {
    const group = await this.getScimGroup(organizationId, id);
    if (!group) return null;
    await this.pool.query(`DELETE FROM scim_groups WHERE id = $1 AND organization_id = $2`, [id, organizationId]);
    return group;
  }

  async scimMemberships(filter: { organizationId?: string; scimUserIds?: string[]; userId?: string }): Promise<ScimUserMembership[]> {
    const { rows } = await this.pool.query<{ id: string; organization_id: string; user_id: string | null; active: boolean; groups: string[] | null }>(
      `SELECT u.id, u.organization_id, u.user_id, u.active,
              COALESCE(array_agg(DISTINCT x.name) FILTER (WHERE x.name IS NOT NULL), '{}') AS groups
         FROM scim_users u
         LEFT JOIN scim_group_members gm ON gm.scim_user_id = u.id
         LEFT JOIN scim_groups g ON g.id = gm.group_id
         LEFT JOIN LATERAL (VALUES (g.display_name), (g.external_id)) x(name) ON true
        WHERE ($1::uuid IS NULL OR u.organization_id = $1)
          AND ($2::uuid[] IS NULL OR u.id = ANY($2))
          AND ($3::uuid IS NULL OR u.user_id = $3)
        GROUP BY u.id`,
      [filter.organizationId ?? null, filter.scimUserIds ? onlyUuids(filter.scimUserIds) : null, filter.userId ?? null],
    );
    return rows.map((r) => ({ scimUserId: r.id, organizationId: r.organization_id, userId: r.user_id, active: r.active, groups: r.groups ?? [] }));
  }
}
