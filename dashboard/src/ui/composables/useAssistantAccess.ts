import { computed, type MaybeRefOrGetter, toValue } from "vue";
import { useAsync } from "./useAsync";
import { useIdentityApi } from "./useIdentityApi";
import { hasPermission } from "./usePermissions";

/**
 * Qué puede hacer la persona sobre la ficha de un asistente (ADR-053). Los permisos de organización (`governance:*`) y los
 * del experimento (`assistant:manage`) llegan por caminos distintos; la API los une igual que aquí.
 */
export function useAssistantAccess(experimentId: MaybeRefOrGetter<string>) {
  const identity = useIdentityApi();
  const experiments = useAsync((signal) => identity.listExperiments(signal));
  const organizations = useAsync((signal) => identity.listOrganizations(signal));
  void experiments.run();
  void organizations.run();

  const experiment = computed(() => (experiments.data.value ?? []).find((e) => e.id === toValue(experimentId)) ?? null);
  const governs = computed(() => hasPermission(experiment.value, "governance:manage") || (organizations.data.value ?? []).some((o) => hasPermission(o, "governance:manage")));
  const canGovern = computed(() => governs.value);
  const canManage = computed(() => governs.value || hasPermission(experiment.value, "assistant:manage"));
  // quién forma parte del agente se elige en los miembros del experimento (Settings): hace falta `member:manage`
  const canManagePeople = computed(() => hasPermission(experiment.value, "member:manage"));
  return { canManage, canGovern, canManagePeople, loading: computed(() => experiments.loading.value || organizations.loading.value) };
}
