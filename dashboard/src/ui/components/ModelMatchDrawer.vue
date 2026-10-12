<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from "vue";
import { useQuasar } from "quasar";
import type { ModelQualityCandidatesResponse } from "@contract";
import { useAsync } from "../composables/useAsync";
import { useIdentityApi } from "../composables/useIdentityApi";
import Button from "./Button.vue";
import EmptyState from "./EmptyState.vue";
import ErrorBanner from "./ErrorBanner.vue";
import LoadingState from "./LoadingState.vue";
import Pill from "./Pill.vue";
import Radio from "./Radio.vue";
import SegmentedControl from "./SegmentedControl.vue";

/**
 * «Confirm Arena matches» (ADR-025): para cada modelo del catálogo que Arena publica con otro nombre, la persona elige qué entrada es el
 * mismo modelo. Solo decide de dónde sale la puntuación de calidad; no cambia nada de cómo corre el agente. Las decisiones valen para toda
 * la organización y quedan en la auditoría. La API exige `pricing:manage`.
 */
const props = defineProps<{ experimentId: string; focusKey?: string | null }>();
const emit = defineEmits<{ close: []; changed: [] }>();

const api = useIdentityApi();
const $q = useQuasar();
const list = useAsync<ModelQualityCandidatesResponse>((signal) => api.listModelQualityCandidates(props.experimentId, "all", signal));

type Group = ModelQualityCandidatesResponse["items"][number];
const tab = ref<"in_use" | "others">("in_use");
/** la entrada elegida de cada modelo; por defecto la del nombre más cercano */
const picked = reactive<Record<string, string>>({});
const busy = reactive<Record<string, boolean>>({});
const failed = reactive<Record<string, string>>({});
const done = reactive<Record<string, true>>({});

const groups = computed(() => (list.data.value?.items ?? []).filter((g) => !done[g.modelKey]));
const inUse = computed(() => groups.value.filter((g) => g.inUse));
const others = computed(() => groups.value.filter((g) => !g.inUse));
const PAGE = 20;
const limit = ref(PAGE);
const all = computed(() => (tab.value === "in_use" ? inUse.value : others.value));
const shown = computed(() => all.value.slice(0, limit.value));
const hidden = computed(() => Math.max(0, all.value.length - limit.value));
const tabs = computed(() => [
  { value: "in_use", label: "In use", count: inUse.value.length },
  { value: "others", label: "Others", count: others.value.length },
]);

function choice(g: Group): string | undefined {
  return picked[g.modelKey] ?? g.candidates[0]?.arenaName;
}

async function load() {
  const result = await list.run();
  if (!result) return;
  const focus = props.focusKey ? result.items.find((g) => g.modelKey === props.focusKey) : undefined;
  // sin nadie en uso, la pestaña vacía no ayuda: se abre la otra
  tab.value = focus ? (focus.inUse ? "in_use" : "others") : result.items.some((g) => g.inUse) || result.items.length === 0 ? "in_use" : "others";
  if (focus) {
    await nextTick();
    [...document.querySelectorAll("[data-testid^='match-card-']")].find((el) => el.getAttribute("data-testid") === `match-card-${focus.modelKey}`)?.scrollIntoView?.({ block: "start" });
  }
}
onMounted(load);

async function settle(g: Group, body: Parameters<typeof api.decideModelMatch>[2], message: string) {
  busy[g.modelKey] = true;
  delete failed[g.modelKey];
  try {
    await api.decideModelMatch(props.experimentId, g.modelKey, body);
    done[g.modelKey] = true;
    $q.notify({ message, color: "positive", timeout: 3000 });
    emit("changed");
  } catch (error) {
    failed[g.modelKey] = error instanceof Error ? error.message : String(error);
  } finally {
    busy[g.modelKey] = false;
  }
}

const confirm = (g: Group) => {
  const arenaName = choice(g);
  if (arenaName) void settle(g, { decision: "confirm", arenaName }, `${g.modelKey} now shows the score of ${arenaName}`);
};
const none = (g: Group) => void settle(g, { decision: "reject", arenaNames: g.candidates.map((c) => c.arenaName) }, `${g.modelKey}: those entries will not be offered again`);
const noEquivalent = (g: Group) => void settle(g, { decision: "no_equivalent" }, `${g.modelKey}: marked as not listed by Arena`);

</script>

<template>
  <Teleport to="body">
    <Transition name="drawer-fade" appear>
      <div class="drawer-backdrop" data-testid="match-backdrop" @click="emit('close')" />
    </Transition>
    <Transition name="drawer-slide" appear>
      <aside class="drawer" role="dialog" aria-label="Confirm Arena matches" data-testid="match-drawer" @keydown.esc="emit('close')">
        <header class="head">
          <div class="head-row">
            <h2>Confirm Arena matches</h2>
            <Button variant="icon" aria-label="Close" data-testid="match-close" @click="emit('close')">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </Button>
          </div>
          <p class="intro">
            Arena lists models under its own names. Choose the entry that is the same model as yours, so its Elo shows in Model pricing. This only sets where the quality score comes from; nothing changes in how your agent runs.
          </p>
          <div class="tabs">
            <SegmentedControl :options="tabs" :model-value="tab" size="sm" aria-label="Models to review" @update:model-value="tab = $event as 'in_use' | 'others'; limit = PAGE" />
            <span class="hint">“In use” = seen in your traces, last 30 days</span>
          </div>
        </header>

        <div class="body">
          <ErrorBanner v-if="list.error.value" :error="list.error.value" @retry="load" />
          <LoadingState v-else-if="list.loading.value && !list.data.value" />
          <EmptyState v-else-if="groups.length === 0" icon="check_circle" title="Nothing to confirm">Every model with a candidate has a decision.</EmptyState>
          <EmptyState v-else-if="shown.length === 0" icon="check_circle" :title="tab === 'in_use' ? 'No model in use is waiting' : 'No other model is waiting'">
            {{ tab === "in_use" ? "The ones you use already have a score or a decision." : "Nothing else has a candidate." }}
          </EmptyState>

          <section v-for="g in shown" :key="g.modelKey" class="card" :data-testid="`match-card-${g.modelKey}`">
            <header class="card-head">
              <span class="label">Your model</span>
              <code class="model">{{ g.model }}</code>
              <Pill v-if="g.inUse" tone="info">In use</Pill>
            </header>
            <p class="ask">ARENA LISTS IT AS… (CHOOSE ONE)</p>
            <ul class="options">
              <li v-for="(c, i) in g.candidates" :key="c.arenaName">
                <Radio
                  class="option"
                  :class="{ chosen: choice(g) === c.arenaName }"
                  :name="`match-${g.modelKey}`"
                  :model-value="choice(g)"
                  :value="c.arenaName"
                  :data-testid="`match-option-${g.modelKey}-${i}`"
                  @update:model-value="picked[g.modelKey] = String($event)"
                >
                  <span class="opt">
                    <span class="opt-main">
                      <code class="arena-name">{{ c.arenaName }}</code>
                      <Pill v-if="i === 0" tone="info">CLOSEST NAME</Pill>
                    </span>
                    <span class="reason">{{ c.reason }}</span>
                  </span>
                  <span class="opt-score">
                    <b>{{ c.elo }}</b> <small>±{{ c.ci }}</small>
                    <small class="votes">#{{ c.rank }} · {{ c.votes.toLocaleString("en-US") }} votes</small>
                  </span>
                </Radio>
              </li>
            </ul>
            <p v-if="failed[g.modelKey]" class="error" role="alert" :data-testid="`match-error-${g.modelKey}`">Could not save: {{ failed[g.modelKey] }}</p>
            <footer class="actions">
              <Button variant="primary" :loading="busy[g.modelKey]" :disabled="!choice(g)" :data-testid="`match-confirm-${g.modelKey}`" @click="confirm(g)">Confirm match</Button>
              <Button variant="link" :disabled="busy[g.modelKey]" :data-testid="`match-none-${g.modelKey}`" @click="none(g)">None of these</Button>
              <Button variant="link" :disabled="busy[g.modelKey]" :data-testid="`match-noequiv-${g.modelKey}`" @click="noEquivalent(g)">Arena doesn't list it</Button>
              <span class="grow" />
              <span class="saved">Saved; later syncs keep it</span>
            </footer>
          </section>
          <Button v-if="hidden > 0" class="more" data-testid="match-more" @click="limit += PAGE">Show {{ Math.min(PAGE, hidden) }} more ({{ hidden }} left)</Button>
        </div>

        <footer class="foot">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          <span>Decisions apply to the whole organization and are saved in the audit log. Only people who can manage pricing see these buttons.</span>
        </footer>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer-backdrop { position: fixed; inset: 0; z-index: 1000; background: rgba(10, 35, 33, 0.28); }
.drawer {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 1001; width: min(600px, 100vw);
  display: flex; flex-direction: column; background: var(--mt-surface, var(--mt-bg)); border-left: 1px solid var(--mt-line); box-shadow: -16px 0 40px rgba(10, 35, 33, 0.18);
}
.drawer-fade-enter-active, .drawer-fade-leave-active { transition: opacity 0.2s ease; }
.drawer-fade-enter-from, .drawer-fade-leave-to { opacity: 0; }
.drawer-slide-enter-active { transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1); }
.drawer-slide-enter-from { transform: translateX(100%); }
@media (prefers-reduced-motion: reduce) { .drawer-fade-enter-active, .drawer-fade-leave-active, .drawer-slide-enter-active { transition: none; } }

.head { flex: none; padding: 18px 24px 14px; border-bottom: 1px solid var(--mt-line); display: flex; flex-direction: column; gap: 8px; }
.head-row { display: flex; align-items: center; justify-content: space-between; }
h2 { margin: 0; font-size: 17px; font-weight: 800; letter-spacing: -0.01em; }
.intro { margin: 0; color: var(--mt-muted); line-height: 1.45; font-size: 13px; }
.tabs { display: flex; align-items: center; gap: 12px; padding-top: 4px; }
.hint { font-size: 12px; color: var(--mt-muted); }
.body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 24px; display: flex; flex-direction: column; gap: 14px; }

.card { flex: none; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-lg); background: var(--mt-bg); overflow: hidden; }
.card-head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: var(--mt-soft); border-bottom: 1px solid var(--mt-line); }
.label { font-size: 12px; color: var(--mt-muted); }
.model { font-size: 13px; }
.ask { margin: 0; padding: 12px 16px 6px; font-size: 11px; font-weight: 800; letter-spacing: 0.06em; color: var(--mt-muted); }
.options { list-style: none; margin: 0; padding: 0 8px; display: flex; flex-direction: column; gap: 4px; }
.option { width: 100%; box-sizing: border-box; align-items: flex-start; gap: 12px; padding: 10px 8px; border: 1px solid transparent; border-radius: var(--mt-radius-lg); }
.option.chosen { background: var(--mt-accent-soft); border-color: var(--mt-accent); }
.option :deep(.dot) { margin-top: 3px; }
.opt { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
.opt-main { display: flex; align-items: center; gap: 8px; min-width: 0; }
.arena-name { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reason { font-size: 12px; font-weight: 500; color: var(--mt-muted); }
.opt-score { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex: none; font-variant-numeric: tabular-nums; }
.opt-score small { font-size: 11px; font-weight: 500; color: var(--mt-muted); }
.error { margin: 6px 16px 0; color: var(--mt-err-ink); font-size: 12.5px; }
.actions { display: flex; align-items: center; gap: 12px; padding: 10px 16px 14px; flex-wrap: wrap; }
.grow { flex: 1; }
.more { align-self: center; flex: none; }
.saved { font-size: 11px; color: var(--mt-muted); }
.foot { flex: none; display: flex; align-items: center; gap: 10px; padding: 12px 24px; border-top: 1px solid var(--mt-line); background: var(--mt-soft); color: var(--mt-muted); font-size: 12px; line-height: 1.4; }
.foot svg { flex: none; }
</style>
