import type {
  ApiKey,
  Experiment,
  ExperimentAccess,
  ExperimentRole,
  ExperimentSummary,
  Member,
  Organization,
  OrganizationSummary,
  PendingInvitation,
  PendingInvitationTarget,
  User,
} from "@/domain/identity";

/** Puerto hacia el almacén de identidad (PostgreSQL, ver ADR-013). Auth.js gestiona users/accounts/sessions aparte. */
export interface IdentityRepository {
  getUserByEmail(email: string): Promise<User | null>;

  createOrganization(name: string, ownerUserId: string): Promise<Organization>;
  getOrganization(organizationId: string): Promise<Organization | null>;
  /** Todas las organizaciones visibles (org_admin, o con al menos un experimento con membership directa). */
  listOrganizationsForUser(userId: string): Promise<OrganizationSummary[]>;
  isOrgAdmin(userId: string, organizationId: string): Promise<boolean>;
  addOrgAdmin(organizationId: string, userId: string): Promise<void>;
  listOrgMembers(organizationId: string): Promise<Member[]>;

  createExperiment(organizationId: string, name: string, serviceName: string): Promise<Experiment>;
  getExperiment(experimentId: string): Promise<Experiment | null>;
  listExperimentsForUser(userId: string): Promise<ExperimentSummary[]>;

  addExperimentMember(experimentId: string, userId: string, role: ExperimentRole): Promise<void>;
  listExperimentMembers(experimentId: string): Promise<Member[]>;

  /** Guarda una invitación para alguien que todavía no tiene cuenta en MemTrace. */
  createPendingInvitation(email: string, target: PendingInvitationTarget, invitedByUserId: string): Promise<void>;
  /** Aplica (y borra) las invitaciones pendientes de este email al crear la cuenta (events.createUser en auth.ts). */
  applyPendingInvitations(userId: string, email: string): Promise<void>;
  /** Invitaciones sin aceptar todavía de una organización o experimento concreto, más recientes primero. */
  listPendingInvitations(target: { organizationId: string } | { experimentId: string }): Promise<PendingInvitation[]>;

  /** org_admin de la organización dueña del experimento, o membership directa. `null` si no hay acceso. */
  resolveExperimentAccess(userId: string, experimentId: string): Promise<ExperimentAccess>;

  /** Devuelve la key en claro (única vez) además de sus metadatos. */
  createApiKey(experimentId: string, createdByUserId: string): Promise<{ apiKey: ApiKey; plaintext: string }>;
  listApiKeys(experimentId: string): Promise<ApiKey[]>;
  revokeApiKey(experimentId: string, keyId: string): Promise<void>;
  /** Para el gateway de ingesta (piece 9): experimentId de una key en claro válida y no revocada, o `null`. */
  resolveApiKey(plaintext: string): Promise<{ experimentId: string; serviceName: string } | null>;
}
