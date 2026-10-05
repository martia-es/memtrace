import type { IdentityRepository } from "@/application/ports/identity-repository";
import type { ExperimentAccess } from "@/domain/identity";
import type { Permission } from "@/domain/permissions";

/**
 * Regla de autorización única (ADR-052): los permisos efectivos de una persona en un experimento son la unión de los
 * de su rol de organización y los de su rol de experimento. Nadie fuera de aquí compara nombres de rol.
 */
export class AuthorizationService {
  constructor(private readonly identity: IdentityRepository) {}

  async resolveExperimentAccess(userId: string, experimentId: string): Promise<ExperimentAccess> {
    return this.identity.resolveExperimentAccess(userId, experimentId);
  }

  async can(userId: string, experimentId: string, permission: Permission): Promise<boolean> {
    const access = await this.resolveExperimentAccess(userId, experimentId);
    return !!access && access.permissions.includes(permission);
  }

  async canReadExperiment(userId: string, experimentId: string): Promise<boolean> {
    return this.can(userId, experimentId, "experiment:read");
  }

  async canInOrganization(userId: string, organizationId: string, permission: Permission): Promise<boolean> {
    return this.identity.hasOrganizationPermission(userId, organizationId, permission);
  }

  async canManageOrganization(userId: string, organizationId: string): Promise<boolean> {
    return this.identity.isOrgAdmin(userId, organizationId);
  }
}
