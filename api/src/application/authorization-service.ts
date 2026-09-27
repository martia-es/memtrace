import type { IdentityRepository } from "@/application/ports/identity-repository";
import type { ExperimentAccess } from "@/domain/identity";

/**
 * Regla de autorización única (ADR-013 sección 3):
 * acceso a un experimento = org_admin de su organización OR membership directa.
 */
export class AuthorizationService {
  constructor(private readonly identity: IdentityRepository) {}

  async resolveExperimentAccess(userId: string, experimentId: string): Promise<ExperimentAccess> {
    return this.identity.resolveExperimentAccess(userId, experimentId);
  }

  async canReadExperiment(userId: string, experimentId: string): Promise<boolean> {
    return (await this.resolveExperimentAccess(userId, experimentId)) !== null;
  }

  async canManageExperimentMembers(userId: string, experimentId: string): Promise<boolean> {
    const access = await this.resolveExperimentAccess(userId, experimentId);
    return access === "org_admin" || access === "admin";
  }

  async canManageOrganization(userId: string, organizationId: string): Promise<boolean> {
    return this.identity.isOrgAdmin(userId, organizationId);
  }
}
