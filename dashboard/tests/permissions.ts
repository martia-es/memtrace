/** Permisos de los roles de serie (ADR-052), para construir sesiones de prueba sin repetirlos. */
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  org_admin: ["org:manage", "experiment:create", "member:manage", "apikey:manage_all", "governance:read", "governance:manage"],
  technical: ["experiment:read", "trace:read_technical", "annotation:write", "queue:manage", "queue:curate", "scoreconfig:manage", "dataset:write", "apikey:manage_own", "assistant:manage"],
  business: ["experiment:read", "annotation:write"],
  governance: ["governance:read", "governance:manage"],
};
export const permissionsOf = (role: string): string[] => ROLE_PERMISSIONS[role] ?? [];
