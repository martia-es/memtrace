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
  const canDeploy = computed(() => governs.value || hasPermission(experiment.value, "deploy:run"));
  // quién forma parte del agente se elige en los miembros del experimento (Settings): hace falta `member:manage`
  const canManagePeople = computed(() => hasPermission(experiment.value, "member:manage"));
  // el riesgo se gestiona en Settings de la organización: el enlace solo se ofrece a quien puede leer la gobernanza (ADR-102)
  const organizationId = computed(() => {
    const orgId = experiment.value?.organizationId;
    const org = (organizations.data.value ?? []).find((o) => o.id === orgId);
    return orgId && org && (hasPermission(org, "governance:read") || hasPermission(org, "retention:manage")) ? orgId : null;
  });
  return { canManage, canGovern, canDeploy, canManagePeople, organizationId, loading: computed(() => experiments.loading.value || organizations.loading.value) };
}
