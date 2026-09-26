import { computed } from "vue";
import { useRoute, useRouter, type LocationQueryValue } from "vue-router";
import { DEFAULT_RANGE, isRangeKey, type RangeKey } from "@/domain/time-range";

const first = (value: LocationQueryValue | LocationQueryValue[] | undefined): string | undefined => {
  const v = Array.isArray(value) ? value[0] : value;
  return v ? v : undefined;
};

/** Filtros compartidos (rango y servicio) sincronizados con la URL: los enlaces son compartibles. */
export function useFilters() {
  const route = useRoute();
  const router = useRouter();

  const range = computed<RangeKey>(() => {
    const value = first(route.query.range);
    return isRangeKey(value) ? value : DEFAULT_RANGE;
  });
  const service = computed(() => first(route.query.service));
  const status = computed<"ok" | "error" | undefined>(() => {
    const value = first(route.query.status);
    return value === "ok" || value === "error" ? value : undefined;
  });
  const hasErrors = computed(() => first(route.query.hasErrors) === "1");
  const conversationId = computed(() => first(route.query.conversation));
  const minDurationMs = computed(() => {
    const value = Number(first(route.query.min));
    return Number.isFinite(value) && value > 0 ? value : undefined;
  });

  function update(patch: Record<string, string | undefined>) {
    const query = { ...route.query };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === "") delete query[key];
      else query[key] = value;
    }
    void router.replace({ query });
  }

  return {
    range,
    service,
    status,
    hasErrors,
    conversationId,
    minDurationMs,
    setRange: (value: RangeKey) => update({ range: value === DEFAULT_RANGE ? undefined : value }),
    setService: (value: string | null | undefined) => update({ service: value ?? undefined }),
    setStatus: (value: "ok" | "error" | undefined) => update({ status: value }),
    setHasErrors: (value: boolean) => update({ hasErrors: value ? "1" : undefined }),
    setConversation: (value: string | undefined) => update({ conversation: value }),
    setMinDuration: (value: number | undefined) => update({ min: value ? String(value) : undefined }),
    /** query que se conserva al navegar entre secciones */
    shared: computed(() => ({ ...(first(route.query.range) ? { range: first(route.query.range) } : {}), ...(service.value ? { service: service.value } : {}) })),
  };
}
