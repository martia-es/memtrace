/** Puerto de salida: identidad y RBAC (ADR-013). Separado de TraceApi: es otro dominio, otro almacén. */

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

/** Tema visual de una organización (ADR-019). `null` en un campo = usar el default de app.css. */
export interface OrganizationThemeDto {
  accentColor: string | null;
  radiusPreset: "sharp" | "soft" | "round" | null;
}

export interface OrganizationDto {
  id: string;
  name: string;
  /** org_admin si el usuario lo es; null si solo la ve por membership directa en un experimento suyo (ADR-016). */
  myRole: "org_admin" | null;
  theme: OrganizationThemeDto;
}

export interface ExperimentDto {
  id: string;
  organizationId: string;
  name: string;
  serviceName: string;
  myRole: "org_admin" | "admin" | "member";
  /** Tema de la organización dueña, embebido para que MainLayout lo aplique sin otra llamada. */
  organizationTheme: OrganizationThemeDto;
}

export interface ApiKeyDto {
  id: string;
  experimentId: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface MemberDto {
  userId: string;
  email: string;
  name: string | null;
  role: "org_admin" | "admin" | "member";
}

export interface PendingInvitationDto {
  id: string;
  email: string;
  role: "org_admin" | "admin" | "member";
  createdAt: string;
}

export interface MembersResponseDto {
  members: MemberDto[];
  pendingInvitations: PendingInvitationDto[];
}

export interface IdentityApi {
  /** `null` si no hay sesión (401) — nunca lanza para ese caso, es la forma normal de comprobar el login. */
  getMe(signal?: AbortSignal): Promise<CurrentUser | null>;
  listOrganizations(signal?: AbortSignal): Promise<OrganizationDto[]>;
  createOrganization(name: string, signal?: AbortSignal): Promise<OrganizationDto>;
  addOrgAdmin(organizationId: string, email: string, signal?: AbortSignal): Promise<void>;
  listOrgMembers(organizationId: string, signal?: AbortSignal): Promise<MembersResponseDto>;
  updateOrganizationTheme(organizationId: string, theme: OrganizationThemeDto, signal?: AbortSignal): Promise<OrganizationDto>;
  listExperiments(signal?: AbortSignal): Promise<ExperimentDto[]>;
  createExperiment(organizationId: string, name: string, serviceName: string, signal?: AbortSignal): Promise<ExperimentDto>;
  addExperimentMember(experimentId: string, email: string, role: "admin" | "member", signal?: AbortSignal): Promise<void>;
  listExperimentMembers(experimentId: string, signal?: AbortSignal): Promise<MembersResponseDto>;
  listApiKeys(experimentId: string, signal?: AbortSignal): Promise<ApiKeyDto[]>;
  /** El campo `plaintext` solo viene relleno aquí — no se puede volver a consultar después. */
  createApiKey(experimentId: string, signal?: AbortSignal): Promise<ApiKeyDto & { plaintext: string }>;
  revokeApiKey(experimentId: string, keyId: string, signal?: AbortSignal): Promise<void>;
}
