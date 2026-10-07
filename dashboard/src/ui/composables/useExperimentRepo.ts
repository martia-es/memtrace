import { inject, ref, toValue, watch, type MaybeRefOrGetter } from "vue";
import type { RepoConfigDto } from "@contract";
import { ASSISTANT_API } from "@/dependency-container";

const cache = new Map<string, Promise<RepoConfigDto | null>>();

/**
 * Repositorio del agente de un experimento, para enlazar un commit (ADR-065). Es solo un adorno: si la persona no puede
 * leer la ficha o el agente no declara repo, devuelve null y el commit se muestra sin enlace.
 */
export function useExperimentRepo(experimentId: MaybeRefOrGetter<string | null | undefined>) {
  const api = inject(ASSISTANT_API, null); // opcional: sin él (o sin permiso) el commit se muestra sin enlace
  const repo = ref<RepoConfigDto | null>(null);
  watch(
    () => toValue(experimentId),
    async (id) => {
      if (!id || !api) {
        repo.value = null;
        return;
      }
      if (!cache.has(id)) {
        cache.set(
          id,
          api.getAssistant(id).then(
            (card) => card.repo,
            () => {
              cache.delete(id); // un fallo no se recuerda: la siguiente vista lo reintenta
              return null;
            },
          ),
        );
      }
      const found = await cache.get(id)!;
      if (toValue(experimentId) === id) repo.value = found;
    },
    { immediate: true },
  );
  return repo;
}
