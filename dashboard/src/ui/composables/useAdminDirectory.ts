import { reactive, ref } from "vue";
import { useQuasar } from "quasar";
import type { ExperimentDto, MembersResponseDto, OrganizationDto } from "@/application/identity-api";
import { hasPermission } from "./usePermissions";
import { useIdentityApi } from "./useIdentityApi";

/**
 * Datos del área de administración (ADR-037): organizaciones, experimentos y miembros. Cada página de admin
 * llama a `load()` al montarse y a `reload()` tras cualquier cambio. Los permisos por fila siguen ADR-016.
 */

// Ver miembros exige poder gestionarlos (ADR-052): quien no tiene `member:manage` solo ve su propio acceso, así que no
// pedimos la lista donde no lo tiene (evita 403 en cascada).
export function canManageOrg(o: OrganizationDto): boolean {
  return hasPermission(o, "org:manage");
}
export function canManageExperiment(e: ExperimentDto): boolean {
  return hasPermission(e, "member:manage");
}
export function canUseApiKeys(e: ExperimentDto): boolean {
  return hasPermission(e, "apikey:manage_own") || hasPermission(e, "apikey:manage_all");
}

const ROLE_LABELS: Record<string, string> = { org_admin: "org_admin", technical: "technical", business: "business" };
/** Etiqueta de un rol; un rol propio que no conocemos se muestra con su nombre. */
export const ROLE_LABEL: Record<string, string> = new Proxy(ROLE_LABELS, { get: (t, k) => t[k as string] ?? String(k) });

/** Tono de `Pill` de un rol: org_admin destaca; el resto, neutro. */
export function roleTone(role: string): "accent" | "neutral" {
  return role === "org_admin" ? "accent" : "neutral";
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

export function formatDate(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-US", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function notifyErrorWith(notify: ReturnType<typeof useQuasar>["notify"], action: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  notify({ message: `${action}: ${detail}`, color: "negative", timeout: 4000 });
}

export function useAdminDirectory() {
  const api = useIdentityApi();
  const $q = useQuasar();

  const organizations = ref<OrganizationDto[]>([]);
  const experiments = ref<ExperimentDto[]>([]);
  const membersByOrg = reactive<Record<string, MembersResponseDto>>({});
  const membersByExperiment = reactive<Record<string, MembersResponseDto>>({});
  const loading = ref(true);
  const loadError = ref<string | null>(null);

  async function load() {
    loading.value = true;
    loadError.value = null;
    try {
      const [orgs, exps] = await Promise.all([api.listOrganizations(), api.listExperiments()]);
      organizations.value = orgs;
      experiments.value = exps;
      await loadMembers();
    } catch (error) {
      loadError.value = error instanceof Error ? error.message : String(error);
    } finally {
      loading.value = false;
    }
  }

  async function loadMembers() {
    await Promise.all([
      ...organizations.value.filter(canManageOrg).map(async (o) => {
        membersByOrg[o.id] = await api.listOrgMembers(o.id);
      }),
      ...experiments.value.filter(canManageExperiment).map(async (e) => {
        membersByExperiment[e.id] = await api.listExperimentMembers(e.id);
      }),
    ]);
  }

  /** Recarga todo tras una mutación. Los errores se muestran como notificación, sin romper la página. */
  async function reload() {
    try {
      const [orgs, exps] = await Promise.all([api.listOrganizations(), api.listExperiments()]);
      organizations.value = orgs;
      experiments.value = exps;
      await loadMembers();
    } catch (error) {
      notifyErrorWith($q.notify, "Could not refresh", error);
    }
  }

  function notifyError(action: string, error: unknown) {
    notifyErrorWith($q.notify, action, error);
  }

  return { organizations, experiments, membersByOrg, membersByExperiment, loading, loadError, load, reload, notifyError };
}
