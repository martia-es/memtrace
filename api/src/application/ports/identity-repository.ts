import type {
  ApiKey,
  Experiment,
  ExperimentAccess,
  ExperimentRole,
  Organization,
  PendingInvitationTarget,
  User,
} from "@/domain/identity";

/** Puerto hacia el almacén de identidad (PostgreSQL, ver ADR-013). Auth.js gestiona users/accounts/sessions aparte. */
export interface IdentityRepository {
  getUserByEmail(email: string): Promise<User | null>;

  createOrganization(name: string, ownerUserId: string): Promise<Organization>;
  getOrganization(organizationId: string): Promise<Organization | null>;
  listOrganizationsForUser(userId: string): Promise<Organization[]>;
  isOrgAdmin(userId: string, organizationId: string): Promise<boolean>;
  addOrgAdmin(organizationId: string, userId: string): Promise<void>;

  createExperiment(organizationId: string, name: string, serviceName: string): Promise<Experiment>;
  getExperiment(experimentId: string): Promise<Experiment | null>;
  listExperimentsForUser(userId: string): Promise<Experiment[]>;

  addExperimentMember(experimentId: string, userId: string, role: ExperimentRole): Promise<void>;

  /** Guarda una invitación para alguien que todavía no tiene cuenta en MemTrace. */
  createPendingInvitation(email: string, target: PendingInvitationTarget, invitedByUserId: string): Promise<void>;
  /** Aplica (y borra) las invitaciones pendientes de este email al crear la cuenta (events.createUser en auth.ts). */
  applyPendingInvitations(userId: string, email: string): Promise<void>;

  /** org_admin de la organización dueña del experimento, o membership directa. `null` si no hay acceso. */
  resolveExperimentAccess(userId: string, experimentId: string): Promise<ExperimentAccess>;

  /** Devuelve la key en claro (única vez) además de sus metadatos. */
  createApiKey(experimentId: string, createdByUserId: string): Promise<{ apiKey: ApiKey; plaintext: string }>;
  listApiKeys(experimentId: string): Promise<ApiKey[]>;
  revokeApiKey(experimentId: string, keyId: string): Promise<void>;
  /** Para el gateway de ingesta (piece 9): experimentId de una key en claro válida y no revocada, o `null`. */
  resolveApiKey(plaintext: string): Promise<{ experimentId: string; serviceName: string } | null>;
}
