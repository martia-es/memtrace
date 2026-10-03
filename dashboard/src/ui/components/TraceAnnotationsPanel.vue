<script setup lang="ts">
import { computed, inject, reactive, ref, watch } from "vue";
import { useQuasar } from "quasar";
import type { AnnotationDto, ScoreConfigDto, TraceAnnotationsResponse } from "@contract";
import { CURRENT_EXPERIMENT } from "@/dependency-container";
import { shortId } from "@/domain/format";
import { useIdentityApi } from "../composables/useIdentityApi";
import { useTraceApi } from "../composables/useTraceApi";
import { numericChoices } from "../score-config-form";
import NewScoreConfigModal from "./NewScoreConfigModal.vue";

/**
 * Anotación humana de una traza (ADR-037): una persona puntúa la traza (o un span) con las rúbricas del
 * experimento (ADR-036). Aquí solo se edita la anotación PROPIA; las de los demás se listan, y un admin
 * puede retirarlas. Los scores automáticos de la misma traza se muestran aparte, con su origen.
 */
const props = defineProps<{ traceId: string; experimentId: string; span: { spanId: string; name: string } | null }>();

const traceApi = useTraceApi();
const identityApi = useIdentityApi();
const $q = useQuasar();
const currentExperiment = inject(CURRENT_EXPERIMENT, computed(() => null));
const canModerate = computed(() => currentExperiment.value?.myRole === "admin" || currentExperiment.value?.myRole === "org_admin");

const configs = ref<ScoreConfigDto[]>([]);
const judgments = ref<TraceAnnotationsResponse>({ annotations: [], scores: [] });
const myUserId = ref<string | null>(null);
const loading = ref(true);
const savingId = ref<string | null>(null);
const showNewConfig = ref(false);

function notifyError(action: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  $q.notify({ message: `${action}: ${detail}`, color: "negative", timeout: 4000 });
}

async function load() {
  loading.value = true;
  try {
    const [me, list, annotated] = await Promise.all([
      identityApi.getMe(),
      identityApi.listScoreConfigs(props.experimentId),
      traceApi.listTraceAnnotations(props.traceId),
    ]);
    myUserId.value = me?.id ?? null;
    configs.value = list;
    judgments.value = annotated;
  } catch (error) {
    notifyError("Could not load annotations", error);
  } finally {
    loading.value = false;
  }
}
void load();

// ---- scope: the whole trace or the span selected in the tree ----
const onSpan = ref(false);
const scopeSpanId = computed(() => (onSpan.value && props.span ? props.span.spanId : null));
watch(() => props.span, (span) => {
  if (!span) onSpan.value = false;
});

// ---- drafts: one per config, prefilled from my existing label for the current scope ----
const drafts = reactive<Record<string, { value: string; comment: string }>>({});

function mine(configId: string): AnnotationDto | undefined {
  return judgments.value.annotations.find((a) => a.configId === configId && a.annotator.id === myUserId.value && a.spanId === scopeSpanId.value);
}

watch(
  [configs, judgments, scopeSpanId],
  () => {
    for (const config of configs.value) {
      const existing = mine(config.id);
      drafts[config.id] = { value: existing?.value ?? "", comment: existing?.comment ?? "" };
    }
  },
  { immediate: true },
);

function isDirty(config: ScoreConfigDto): boolean {
  const draft = drafts[config.id];
  const existing = mine(config.id);
  if (!draft || draft.value === "") return false;
  return draft.value !== (existing?.value ?? "") || draft.comment.trim() !== (existing?.comment ?? "");
}

async function save(config: ScoreConfigDto) {
  const draft = drafts[config.id];
  if (!draft || draft.value === "") return;
  savingId.value = config.id;
  try {
    judgments.value = await traceApi.saveTraceAnnotation(props.traceId, {
      configId: config.id,
      value: draft.value,
      comment: draft.comment.trim() || null,
      spanId: scopeSpanId.value,
    });
  } catch (error) {
    notifyError("Could not save annotation", error);
  } finally {
    savingId.value = null;
  }
}

async function retract(annotation: AnnotationDto) {
  try {
    const own = annotation.annotator.id === myUserId.value;
    await traceApi.retractTraceAnnotation(props.traceId, annotation.configId, { spanId: annotation.spanId, ...(own ? {} : { annotatorId: annotation.annotator.id }) });
    judgments.value = await traceApi.listTraceAnnotations(props.traceId);
  } catch (error) {
    notifyError("Could not retract annotation", error);
  }
}

// ---- controls per data type ----
function choices(config: ScoreConfigDto): Array<{ value: string; label: string }> | null {
  if (config.dataType === "boolean") return [{ value: "true", label: "Yes" }, { value: "false", label: "No" }];
  if (config.dataType === "categorical") return (config.categories ?? []).map((c) => ({ value: c.label, label: c.label }));
  return numericChoices(config)?.map((n) => ({ value: String(n), label: String(n) })) ?? null;
}

const canAct = (annotation: AnnotationDto) => annotation.annotator.id === myUserId.value || canModerate.value;
const authorOf = (annotation: AnnotationDto) => (annotation.annotator.id === myUserId.value ? "You" : (annotation.annotator.name ?? "Former member"));
const scopeOf = (annotation: AnnotationDto) => (annotation.spanId ? `span ${shortId(annotation.spanId)}` : "whole trace");
</script>

<template>
  <div class="annotations" data-testid="annotations-panel">
    <p v-if="loading" class="hint">Loading…</p>

    <template v-else>
      <div v-if="span" class="scope" role="group" aria-label="What to annotate">
        <button type="button" class="scope-btn" :class="{ active: !onSpan }" @click="onSpan = false">Whole trace</button>
        <button type="button" class="scope-btn" :class="{ active: onSpan }" :title="span.name" @click="onSpan = true">Selected span</button>
        <span class="hint span-name">{{ span.name }}</span>
      </div>

      <p v-if="!configs.length" class="hint" data-testid="no-configs">
        There are no score configs yet — they define what you can score.
        <template v-if="!canModerate">Ask an experiment admin to create them.</template>
      </p>
      <button v-if="canModerate" type="button" class="scope-btn" data-testid="new-config" @click="showNewConfig = true">New score config</button>
      <NewScoreConfigModal v-if="showNewConfig" :experiment-id="experimentId" @close="showNewConfig = false" @created="load" />

      <section v-for="config in configs" :key="config.id" class="config" data-testid="annotation-config">
        <div class="config-head">
          <span class="config-name">{{ config.name }}</span>
          <span v-if="mine(config.id)" class="mine-pill">your label saved</span>
        </div>
        <p v-if="config.description" class="hint">{{ config.description }}</p>

        <div class="controls" v-if="drafts[config.id]">
          <div v-if="choices(config)" class="choice-row">
            <button
              v-for="choice in choices(config)"
              :key="choice.value"
              type="button"
              class="choice-btn"
              :class="{ active: drafts[config.id]!.value === choice.value }"
              @click="drafts[config.id]!.value = choice.value"
            >
              {{ choice.label }}
            </button>
          </div>
          <input
            v-else
            v-model="drafts[config.id]!.value"
            class="text-input num"
            type="number"
            step="any"
            :min="config.minValue ?? undefined"
            :max="config.maxValue ?? undefined"
            :placeholder="`${config.minValue} – ${config.maxValue}`"
            :aria-label="`${config.name} value`"
          />
          <input v-model="drafts[config.id]!.comment" class="text-input" placeholder="Comment (optional)" :aria-label="`${config.name} comment`" maxlength="5000" />
          <button type="button" class="primary-btn" :disabled="savingId === config.id || !isDirty(config)" @click="save(config)">Save</button>
        </div>
      </section>

      <section v-if="judgments.annotations.length" class="list" aria-label="Human labels">
        <h3>Human labels</h3>
        <ul>
          <li v-for="a in judgments.annotations" :key="`${a.configId}|${a.spanId}|${a.annotator.id}`" class="row" data-testid="annotation-row">
            <span class="row-name">{{ a.configName }}</span>
            <span class="row-value mono">{{ a.value }}</span>
            <span class="hint">{{ authorOf(a) }} · {{ scopeOf(a) }}</span>
            <span v-if="a.comment" class="row-comment">“{{ a.comment }}”</span>
            <button v-if="canAct(a)" type="button" class="small-btn" @click="retract(a)">Retract</button>
          </li>
        </ul>
      </section>

      <section v-if="judgments.scores.length" class="list" aria-label="Automatic scores">
        <h3>Automatic scores</h3>
        <ul>
          <li v-for="(s, i) in judgments.scores" :key="i" class="row" data-testid="score-row">
            <span class="row-name">{{ s.name }}</span>
            <span class="row-value mono">{{ s.value }}</span>
            <span class="source-pill">{{ s.source }}</span>
            <span v-if="s.comment" class="row-comment">“{{ s.comment }}”</span>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.annotations {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.hint {
  color: var(--mt-muted);
  font-size: 12.5px;
  margin: 0;
}
.span-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 260px;
}
.scope {
  display: flex;
  align-items: center;
  gap: 6px;
}
.scope-btn,
.choice-btn {
  height: 28px;
  min-width: 34px;
  padding: 0 12px;
  border-radius: var(--mt-radius-sm);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  color: var(--mt-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.scope-btn.active,
.choice-btn.active {
  background: var(--mt-accent);
  border-color: var(--mt-accent);
  color: var(--mt-accent-ink);
}
.config {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border-radius: var(--mt-radius-lg);
  background: var(--mt-soft);
}
.config-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.config-name {
  font-weight: 700;
  font-size: 13px;
}
.mine-pill,
.source-pill {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--mt-card);
  color: var(--mt-muted);
  font-size: 11px;
  font-weight: 600;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.choice-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.text-input {
  flex: 1;
  min-width: 160px;
  box-sizing: border-box;
  height: 32px;
  padding: 0 12px;
  border-radius: var(--mt-radius-lg);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  font: inherit;
  font-size: 12.5px;
  color: var(--mt-ink);
}
.text-input.num {
  flex: 0 0 120px;
  min-width: 0;
}
.text-input:focus {
  outline: 2px solid var(--mt-accent);
  outline-offset: -1px;
}
.primary-btn {
  height: 32px;
  padding: 0 16px;
  border-radius: var(--mt-radius-lg);
  border: none;
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.list h3 {
  margin: 0 0 6px;
  color: var(--mt-muted);
  font-size: 11.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.list ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--mt-radius-lg);
  background: var(--mt-soft);
  font-size: 12.5px;
}
.row-name {
  font-weight: 600;
}
.row-value {
  font-weight: 700;
}
.row-comment {
  flex-basis: 100%;
  color: var(--mt-muted);
  font-style: italic;
}
.small-btn {
  margin-left: auto;
  height: 24px;
  padding: 0 10px;
  border-radius: var(--mt-radius-sm);
  border: 1px solid var(--mt-err-ink);
  background: transparent;
  color: var(--mt-err-ink);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
</style>
