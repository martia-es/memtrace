/**
 * Permisos de MemTrace (ADR-052). El código solo pregunta por permisos; un rol es un conjunto de permisos guardado
 * como datos (tablas `roles` / `role_permissions`), así que añadir un perfil no toca ninguna ruta.
 */
export const PERMISSIONS = [
  "experiment:read",
  "trace:read_technical",
  "annotation:write",
  "queue:manage",
  "queue:curate",
  "scoreconfig:manage",
  "dataset:write",
  "apikey:manage_own",
  "apikey:manage_all",
  "member:manage",
  "experiment:create",
  "org:manage",
  "governance:read",
  "governance:manage",
  "assistant:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type RoleScope = "organization" | "experiment";

export interface Role {
  name: string;
  scope: RoleScope;
  permissions: Permission[];
}

/**
 * Roles de serie. Es la misma definición que siembra la migración 019; vive aquí para los dobles de prueba y para
 * documentar el catálogo. En producción manda lo que haya en la base de datos.
 */
export const BUILT_IN_ROLES: Role[] = [
  { name: "org_admin", scope: "organization", permissions: ["org:manage", "experiment:create", "member:manage", "apikey:manage_all", "governance:read", "governance:manage"] },
  {
    name: "technical",
    scope: "experiment",
    permissions: ["experiment:read", "trace:read_technical", "annotation:write", "queue:manage", "queue:curate", "scoreconfig:manage", "dataset:write", "apikey:manage_own", "assistant:manage"],
  },
  { name: "business", scope: "experiment", permissions: ["experiment:read", "annotation:write"] },
  /** Revisa el catálogo de asistentes (ADR-053): solo metadatos, ningún dato de trazas. Se asigna por grupo del IdP o a mano. */
  { name: "governance", scope: "organization", permissions: ["governance:read", "governance:manage"] },
];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
