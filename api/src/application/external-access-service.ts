import type { ExternalIdentityRepository, MappedOrganization, ScimUserMembership } from "@/application/ports/external-identity-repository";
import { desiredGrants, readGroupsClaim } from "@/domain/external-access";
import type { ExternalMapping } from "@/domain/external-access";

/**
 * Traduce los grupos del proveedor de identidad del cliente a roles nuestros (ADR-052, fases B y C).
 * Dos entradas, una misma salida: el login OIDC (grupos del token) y SCIM (grupos empujados por el proveedor) acaban
 * en `reconcile`, que deja las membresías externas de esa persona exactamente como dicen los mapeos.
 */
export class ExternalAccessService {
  constructor(private readonly repo: ExternalIdentityRepository) {}

  /**
   * Cada inicio de sesión: enlaza los usuarios SCIM con esta cuenta por email, aplica lo que SCIM ya sabe de ella y
   * concilia con los grupos del token. Si el token no trae la claim de grupos no se quita nada (`readGroupsClaim`).
   */
  async onLogin(userId: string, email: string | null | undefined, claims: Record<string, unknown> | null | undefined): Promise<void> {
    if (email) await this.repo.linkScimUsersByEmail(userId, email);
    await this.applyScim(await this.repo.scimMemberships({ userId }));

    const weights = await this.repo.roleWeights();
    for (const org of await this.repo.listMappedOrganizations()) {
      const groups = readGroupsClaim(claims, org.groupsClaim);
      if (groups === null) continue;
      await this.repo.reconcile(userId, org.organizationId, "oidc", desiredGrants(org.mappings, groups, (r) => weights.get(r) ?? 0));
    }
  }

  /** Vuelve a calcular el acceso de estos usuarios SCIM (o de todos los de la organización) tras un cambio en SCIM o en los mapeos. */
  async resyncScim(organizationId: string, scimUserIds?: string[]): Promise<void> {
    if (scimUserIds && scimUserIds.length === 0) return;
    await this.applyScim(await this.repo.scimMemberships({ organizationId, ...(scimUserIds ? { scimUserIds } : {}) }));
  }

  /** Quita todo lo que SCIM había dado a un usuario que se borra (el recurso ya no existe, así que se pasa su `userId`). */
  async revokeScim(organizationId: string, userId: string | null): Promise<void> {
    if (userId) await this.repo.reconcile(userId, organizationId, "scim", []);
  }

  private async applyScim(entries: ScimUserMembership[]): Promise<void> {
    if (entries.length === 0) return;
    const weights = await this.repo.roleWeights();
    const mappingsByOrg = new Map<string, ExternalMapping[]>();
    for (const entry of entries) {
      if (!entry.userId) continue; // todavía no ha iniciado sesión: se aplicará en su primer login
      let mappings = mappingsByOrg.get(entry.organizationId);
      if (!mappings) {
        mappings = await this.repo.listMappings(entry.organizationId);
        mappingsByOrg.set(entry.organizationId, mappings);
      }
      // Desactivado = sin acceso inmediato, aunque siga en sus grupos.
      const grants = entry.active ? desiredGrants(mappings, entry.groups, (r) => weights.get(r) ?? 0) : [];
      await this.repo.reconcile(entry.userId, entry.organizationId, "scim", grants);
    }
  }

  /** Tras crear o borrar un mapeo: SCIM se recalcula ya; los usuarios por OIDC lo verán en su próximo login. */
  async mappingsChanged(organizationId: string): Promise<void> {
    await this.resyncScim(organizationId);
    // sin ningún mapeo no queda nada que conciliar en el próximo login: lo concedido por OIDC se retira ya
    if ((await this.repo.listMappings(organizationId)).length === 0) await this.repo.purgeExternal(organizationId, "oidc");
  }
}

export type { MappedOrganization };
