/** SCIM 2.0 (RFC 7643/7644): los pedazos puros del protocolo. Los recursos se guardan en `scim_users` / `scim_groups`. */

export const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
export const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
export const SCIM_PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

export interface ScimUser {
  id: string;
  organizationId: string;
  userName: string;
  externalId: string | null;
  displayName: string | null;
  active: boolean;
  /** usuario de MemTrace enlazado por email; null hasta que la persona inicia sesión por primera vez */
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScimGroup {
  id: string;
  organizationId: string;
  displayName: string;
  externalId: string | null;
  /** ids de `scim_users` */
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ScimPatchOp {
  op: string;
  path?: string;
  value?: unknown;
}

/** `userName eq "ana@x.com"` → `{ attribute: "userName", value: "ana@x.com" }`. Es el único filtro que mandan los IdP al sincronizar. */
export function parseEqFilter(filter: string | null | undefined): { attribute: string; value: string } | null {
  if (!filter) return null;
  const m = filter.trim().match(/^([A-Za-z.]+)\s+eq\s+"((?:[^"\\]|\\.)*)"$/i);
  return m ? { attribute: m[1]!, value: m[2]!.replace(/\\(.)/g, "$1") } : null;
}

/** Entra manda `"False"` como texto; Okta y SailPoint mandan booleanos. */
export function parseBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
  }
  return null;
}

/** Cambios sobre un usuario a partir de las operaciones PATCH (con o sin `path`, como los envían Entra, Okta y SailPoint). */
export function userPatch(ops: ScimPatchOp[]): { active?: boolean; displayName?: string | null; externalId?: string | null; userName?: string } {
  const patch: { active?: boolean; displayName?: string | null; externalId?: string | null; userName?: string } = {};
  const set = (key: string, value: unknown) => {
    if (key === "active") {
      const b = parseBoolean(value);
      if (b !== null) patch.active = b;
    } else if (key === "displayName") patch.displayName = typeof value === "string" ? value : null;
    else if (key === "externalId") patch.externalId = typeof value === "string" ? value : null;
    else if (key === "userName" && typeof value === "string") patch.userName = value;
  };
  for (const op of ops) {
    const verb = op.op.toLowerCase();
    if (verb !== "replace" && verb !== "add") continue;
    if (op.path) set(op.path, op.value);
    else if (op.value && typeof op.value === "object") for (const [k, v] of Object.entries(op.value as Record<string, unknown>)) set(k, v);
  }
  return patch;
}

/** Cambios de pertenencia a un grupo a partir de las operaciones PATCH. `replace` sustituye la lista entera. */
export function groupMemberPatch(ops: ScimPatchOp[]): { add: string[]; remove: string[]; replace: string[] | null; displayName?: string } {
  const out: { add: string[]; remove: string[]; replace: string[] | null; displayName?: string } = { add: [], remove: [], replace: null };
  const ids = (value: unknown): string[] =>
    (Array.isArray(value) ? value : value ? [value] : []).map((m) => (m && typeof m === "object" ? (m as { value?: unknown }).value : m)).filter((v): v is string => typeof v === "string");
  for (const op of ops) {
    const verb = op.op.toLowerCase();
    const path = op.path ?? "";
    if (path === "displayName" && typeof op.value === "string") out.displayName = op.value;
    if (path === "members" || path === "") {
      const members = path === "" && op.value && typeof op.value === "object" && !Array.isArray(op.value) ? (op.value as { members?: unknown }).members : op.value;
      const list = ids(members);
      if (verb === "add") out.add.push(...list);
      else if (verb === "replace") out.replace = list;
      else if (verb === "remove" && path === "members") {
        if (list.length) out.remove.push(...list);
        else out.replace = []; // `remove` sin valor vacía el grupo
      }
    }
    const single = path.match(/^members\[value\s+eq\s+"([^"]+)"\]$/i);
    if (single && verb === "remove") out.remove.push(single[1]!);
  }
  return out;
}

export function userResource(baseUrl: string, u: ScimUser) {
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: u.id,
    ...(u.externalId ? { externalId: u.externalId } : {}),
    userName: u.userName,
    ...(u.displayName ? { displayName: u.displayName } : {}),
    emails: [{ value: u.userName, primary: true }],
    active: u.active,
    meta: { resourceType: "User", created: u.createdAt, lastModified: u.updatedAt, location: `${baseUrl}/Users/${u.id}` },
  };
}

export function groupResource(baseUrl: string, g: ScimGroup) {
  return {
    schemas: [SCIM_GROUP_SCHEMA],
    id: g.id,
    ...(g.externalId ? { externalId: g.externalId } : {}),
    displayName: g.displayName,
    members: g.memberIds.map((value) => ({ value, $ref: `${baseUrl}/Users/${value}` })),
    meta: { resourceType: "Group", created: g.createdAt, lastModified: g.updatedAt, location: `${baseUrl}/Groups/${g.id}` },
  };
}

export function listResponse<T>(resources: T[], totalResults: number, startIndex: number) {
  return { schemas: [SCIM_LIST_SCHEMA], totalResults, startIndex, itemsPerPage: resources.length, Resources: resources };
}

export function scimError(status: number, detail: string, scimType?: string) {
  return { schemas: [SCIM_ERROR_SCHEMA], status: String(status), ...(scimType ? { scimType } : {}), detail };
}

/** Identidad del usuario SCIM: `userName` ha de ser el email con el que la persona inicia sesión en MemTrace. */
export function readUserBody(body: Record<string, unknown>) {
  const emails = Array.isArray(body.emails) ? (body.emails as Array<{ value?: unknown; primary?: unknown }>) : [];
  const name = body.name as { formatted?: unknown; givenName?: unknown; familyName?: unknown } | undefined;
  const display =
    typeof body.displayName === "string"
      ? body.displayName
      : typeof name?.formatted === "string"
        ? name.formatted
        : [name?.givenName, name?.familyName].filter((p): p is string => typeof p === "string").join(" ") || null;
  const primary = emails.find((e) => e.primary === true) ?? emails[0];
  const userName = typeof body.userName === "string" && body.userName.trim() ? body.userName.trim() : typeof primary?.value === "string" ? primary.value.trim() : "";
  return {
    userName,
    externalId: typeof body.externalId === "string" ? body.externalId : null,
    displayName: display,
    active: parseBoolean(body.active) ?? true,
  };
}

/** Ids de usuario de la lista `members` de un cuerpo SCIM. */
export function memberIds(value: unknown): string[] {
  return (Array.isArray(value) ? value : []).map((m) => (m as { value?: unknown })?.value).filter((v): v is string => typeof v === "string");
}

