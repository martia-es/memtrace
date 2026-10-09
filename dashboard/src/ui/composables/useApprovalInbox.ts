import { computed, inject, provide, ref, watch, type ComputedRef, type InjectionKey, type Ref } from "vue";
import type { ApprovalRequestDto } from "@contract";
import { CURRENT_EXPERIMENT, PROMPT_API } from "@/dependency-container";

/**
 * Lo que esta persona tiene pendiente de aprobar en su organización (ADR-076). El layout lo carga una vez y lo reparte: el
 * aviso del menú, el Overview y el listado de prompts leen lo mismo. Sin layout (una página suelta) cada uso lo carga solo.
 */
export interface ApprovalInbox {
  items: ComputedRef<ApprovalRequestDto[]>;
  /** ids de los prompts con algo pendiente de esta persona */
  promptIds: ComputedRef<Set<string>>;
  refresh: () => Promise<void>;
}

const KEY: InjectionKey<ApprovalInbox> = Symbol("approval-inbox");

function create(organizationId: Ref<string | null> | ComputedRef<string | null>): ApprovalInbox {
  // sin el puerto de prompts (una pantalla montada sola) no hay bandeja que mostrar
  const api = inject(PROMPT_API, null);
  const data = ref<ApprovalRequestDto[]>([]);
  let seq = 0;
  async function refresh() {
    const id = organizationId.value;
    const mine = ++seq;
    if (!id || !api) {
      data.value = [];
      return;
    }
    try {
      const items = await api.approvalInbox(id);
      if (mine === seq) data.value = items;
    } catch {
      // un aviso que no carga no debe romper la pantalla: simplemente no se muestra
      if (mine === seq) data.value = [];
    }
  }
  const items = computed(() => data.value);
  const promptIds = computed(() => new Set(data.value.map((r) => r.promptId)));
  return { items, promptIds, refresh };
}

/** Lo crea el layout y lo comparte con todo lo que cuelga de él. */
export function provideApprovalInbox(organizationId: ComputedRef<string | null>, enabled: ComputedRef<boolean>, trigger: () => unknown): ApprovalInbox {
  const inbox = create(organizationId);
  watch(
    [organizationId, enabled, trigger],
    () => {
      if (enabled.value) void inbox.refresh();
    },
    { immediate: true },
  );
  provide(KEY, inbox);
  return inbox;
}

export function useApprovalInbox(): ApprovalInbox {
  const shared = inject(KEY, null);
  if (shared) return shared;
  const current = inject(CURRENT_EXPERIMENT, computed(() => null));
  const inbox = create(computed(() => current.value?.organizationId ?? null));
  void inbox.refresh();
  return inbox;
}
