import { computed, inject } from "vue";
import type { ExperimentDto, OrganizationDto } from "@/application/identity-api";
import { CURRENT_EXPERIMENT } from "@/dependency-container";

/** Permisos (ADR-052). La UI decide qué mostrar por permiso, nunca por nombre de rol. */
export type Permission =
  | "experiment:read"
  | "trace:read_technical"
  | "annotation:write"
  | "queue:manage"
  | "queue:curate"
  | "scoreconfig:manage"
  | "dataset:write"
  | "apikey:manage_own"
  | "apikey:manage_all"
  | "member:manage"
  | "experiment:create"
  | "org:manage"
  | "governance:read"
  | "governance:manage"
  | "assistant:manage"
  | "deploy:run"
  | "prompt:read"
  | "prompt:write"
  | "prompt:promote"
  | "prompt:approve"
  | "approval:manage"
  | "catalog:manage"
  | "retention:manage"
  | "audit:read"
  | "data:export"
  | "alert:manage";

export function hasPermission(target: Pick<ExperimentDto | OrganizationDto, "permissions"> | null | undefined, permission: Permission): boolean {
  return !!target && target.permissions.includes(permission);
}

/** Permisos del experimento actual (el de la ruta). */
export function usePermissions() {
  const current = inject(CURRENT_EXPERIMENT, computed(() => null));
  return { can: (permission: Permission) => hasPermission(current.value, permission) };
}
