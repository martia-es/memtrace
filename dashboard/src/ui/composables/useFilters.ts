import { computed } from "vue";
import { useRoute, useRouter, type LocationQueryValue } from "vue-router";
import { DEFAULT_RANGE, isCustomRange, isRangeKey, resolveRange, type CustomRange, type RangeKey, type RangeSelection } from "@/domain/time-range";

const first = (value: LocationQueryValue | LocationQueryValue[] | undefined): string | undefined => {
  const v = Array.isArray(value) ? value[0] : value;
  return v ? v : undefined;
};

/** Filtros compartidos (rango y servicio) sincronizados con la URL: los enlaces son compartibles. */
export function useFilters() {
  const route = useRoute();
  const router = useRouter();

  const customRange = computed<CustomRange | undefined>(() => {
    const from = first(route.query.from);
    const to = first(route.query.to);
    return first(route.query.range) === "custom" && isCustomRange(from, to) ? { from: from!, to: to! } : undefined;
  });
  const range = computed<RangeSelection>(() => {
    if (customRange.value) return "custom";
    const value = first(route.query.range);
    return isRangeKey(value) ? value : DEFAULT_RANGE;
  });
  /** clave estable (primitiva) para `watch`: cambia con el preset o con las fechas propias */
  const rangeSig = computed(() => (customRange.value ? `custom:${customRange.value.from}:${customRange.value.to}` : range.value));
  const service = computed(() => first(route.query.service));
  const status = computed<"ok" | "error" | undefined>(() => {
    const value = first(route.query.status);
    return value === "ok" || value === "error" ? value : undefined;
  });
  const kind = computed(() => first(route.query.kind));
  const model = computed(() => first(route.query.model));
  const text = computed(() => first(route.query.q));
  /** versión del código (SHA completo o prefijo, ADR-065) */
  const revision = computed(() => first(route.query.rev));
  /** cómo se listan: por conversación (por defecto, ADR-048) o como trazas sueltas */
  const group = computed<"conversation" | "flat">(() => (first(route.query.group) === "flat" ? "flat" : "conversation"));
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
    customRange,
    rangeSig,
    /** ventana {from,to} ISO de la selección actual (los presets avanzan con el reloj) */
    resolve: () => resolveRange(range.value, Date.now(), customRange.value),
    service,
    status,
    kind,
    model,
    text,
    revision,
    group,
    hasErrors,
    conversationId,
    minDurationMs,
    setRange: (value: RangeKey) => update({ range: value === DEFAULT_RANGE ? undefined : value, from: undefined, to: undefined }),
    setCustomRange: (value: CustomRange) => update({ range: "custom", from: value.from, to: value.to }),
    setService: (value: string | null | undefined) => update({ service: value ?? undefined }),
    setStatus: (value: "ok" | "error" | undefined) => update({ status: value }),
    setKind: (value: string | undefined) => update({ kind: value }),
    setModel: (value: string | undefined) => update({ model: value }),
    setText: (value: string | undefined) => update({ q: value?.trim() || undefined }),
    setRevision: (value: string | undefined) => update({ rev: value?.trim() || undefined }),
    setGroup: (value: "conversation" | "flat") => update({ group: value === "flat" ? "flat" : undefined }),
    setHasErrors: (value: boolean) => update({ hasErrors: value ? "1" : undefined }),
    /** vistas rápidas de la lista (ADR-048): las dos condiciones se aplican en un único cambio de URL */
    setQuickView: (value: "all" | "errors" | "slow") => update({ hasErrors: value === "errors" ? "1" : undefined, min: value === "slow" ? "5000" : undefined }),
    setConversation: (value: string | undefined) => update({ conversation: value }),
    setMinDuration: (value: number | undefined) => update({ min: value ? String(value) : undefined }),
    /** query que se conserva al navegar entre secciones */
    shared: computed(() => ({ ...(customRange.value ? { range: "custom", ...customRange.value } : first(route.query.range) ? { range: first(route.query.range) } : {}), ...(service.value ? { service: service.value } : {}) })),
  };
}
