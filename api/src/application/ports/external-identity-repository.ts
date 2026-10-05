import type { ExternalGrant, ExternalMapping, ExternalSource } from "@/domain/external-access";
import type { ScimGroup, ScimUser } from "@/domain/scim";

export interface ScimToken {
  id: string;
  organizationId: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Un usuario SCIM con los nombres de los grupos a los que pertenece (displayName y externalId), listo para conciliar. */
export interface ScimUserMembership {
  scimUserId: string;
  organizationId: string;
  userId: string | null;
  active: boolean;
  groups: string[];
}

/** Organización que tiene mapeos de grupos, con el nombre de la claim donde buscarlos en el token. */
export interface MappedOrganization {
  organizationId: string;
  groupsClaim: string;
  mappings: ExternalMapping[];
}

export interface NewScimUser {
  userName: string;
  externalId: string | null;
  displayName: string | null;
  active: boolean;
}

/** Puerto de la identidad externa (ADR-052, fases B y C): mapeos de grupos, conciliación de membresías y recursos SCIM. */
export interface ExternalIdentityRepository {
  getGroupsClaim(organizationId: string): Promise<string>;
  setGroupsClaim(organizationId: string, claim: string): Promise<void>;

  listMappings(organizationId: string): Promise<ExternalMapping[]>;
  /** Valida que el rol exista y encaje con el ámbito, y que el experimento sea de la organización (lanza `ValidationError`). */
  createMapping(organizationId: string, input: { externalGroup: string; experimentId: string | null; role: string }): Promise<ExternalMapping>;
  deleteMapping(organizationId: string, mappingId: string): Promise<boolean>;
  listMappedOrganizations(): Promise<MappedOrganization[]>;
  /** Cuántos permisos da cada rol: sirve para elegir el mayor cuando dos grupos dan roles distintos en el mismo sitio. */
  roleWeights(): Promise<Map<string, number>>;

  /**
   * Deja las membresías de `source` de esta persona en esta organización exactamente como `grants`: añade las que
   * faltan y quita las que ya no corresponden. Nunca toca una membresía `manual`, y nunca deja una organización sin
   * ningún `org_admin`.
   */
  reconcile(userId: string, organizationId: string, source: ExternalSource, grants: ExternalGrant[]): Promise<void>;

  /** Quita todas las membresías de `source` de la organización (al borrar su último mapeo). Mismas salvaguardas que `reconcile`. */
  purgeExternal(organizationId: string, source: ExternalSource): Promise<void>;

  createScimToken(organizationId: string, createdBy: string): Promise<{ token: ScimToken; plaintext: string }>;
  listScimTokens(organizationId: string): Promise<ScimToken[]>;
  revokeScimToken(organizationId: string, tokenId: string): Promise<boolean>;
  /** Organización a la que da acceso un token en claro válido y no revocado, o `null`. */
  resolveScimToken(plaintext: string): Promise<string | null>;

  listScimUsers(organizationId: string, query: { userName?: string; startIndex: number; count: number }): Promise<{ total: number; items: ScimUser[] }>;
  getScimUser(organizationId: string, id: string): Promise<ScimUser | null>;
  /** `null` si ya existe un usuario con ese `userName` en la organización. */
  createScimUser(organizationId: string, input: NewScimUser): Promise<ScimUser | null>;
  updateScimUser(organizationId: string, id: string, patch: Partial<NewScimUser>): Promise<ScimUser | null>;
  deleteScimUser(organizationId: string, id: string): Promise<ScimUser | null>;
  /** Enlaza los usuarios SCIM sin enlazar cuyo email coincide; devuelve las organizaciones afectadas. */
  linkScimUsersByEmail(userId: string, email: string): Promise<string[]>;

  listScimGroups(organizationId: string, query: { displayName?: string; startIndex: number; count: number }): Promise<{ total: number; items: ScimGroup[] }>;
  getScimGroup(organizationId: string, id: string): Promise<ScimGroup | null>;
  /** `null` si ya existe un grupo con ese nombre. */
  createScimGroup(organizationId: string, input: { displayName: string; externalId: string | null; memberIds: string[] }): Promise<ScimGroup | null>;
  updateScimGroup(organizationId: string, id: string, patch: { displayName?: string; externalId?: string | null; add?: string[]; remove?: string[]; replace?: string[] | null }): Promise<ScimGroup | null>;
  deleteScimGroup(organizationId: string, id: string): Promise<ScimGroup | null>;

  /** Pertenencias de los usuarios SCIM de una organización (todos, o solo los indicados, o solo los enlazados a `userId`). */
  scimMemberships(filter: { organizationId?: string; scimUserIds?: string[]; userId?: string }): Promise<ScimUserMembership[]>;
}
