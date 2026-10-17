<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import Modal from "./Modal.vue";
import Select from "./Select.vue";
import { computed, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useQuasar } from "quasar";
import type { PromotionSkipReasonDto, QueueResultCriterionDto, QueueResultItemDto, ScoreConfigDto } from "@contract";
import { shortId } from "@/domain/format";
import { countSkipReasons, promotionBatches, rowReadiness, type RowReadiness } from "@/domain/queue-promotion";
import { valueChoices } from "../score-config-form";
import ErrorBanner from "./ErrorBanner.vue";
import TraceThreadPreview from "./TraceThreadPreview.vue";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";
import Button from "./Button.vue";
import Checkbox from "./Checkbox.vue";
import Pill from "./Pill.vue";
import DataTable from "./DataTable.vue";
import LoadingState from "./LoadingState.vue";
import ToggleChip from "./ToggleChip.vue";
import { t, tp } from "../i18n";
import { lazyMessages } from "../../domain/translate";

/**
 * Resultados de una cola para el perfil técnico (ADR-050): qué respondió cada revisor por item y criterio, los
 * desacuerdos, la resolución del técnico (capa aparte, no toca las etiquetas) y la promoción de lo elegido a un dataset.
 */
const props = defineProps<{ queueId: string }>();
const emit = defineEmits<{ close: [] }>();

const UNREVIEWABLE_NOTE = lazyMessages({ note: "queueResults.marked_unreviewable_by_a_reviewer_not" }).note;
const REASONS: Record<PromotionSkipReasonDto, string> = lazyMessages({
  already_promoted: "queueResults.already_in_the_dataset",
  no_content: "queueResults.no_input_saved",
  not_found: "queueResults.not_found",
  ambiguous_label: "queueResults.reviewers_disagree",
  unsupported_label: "queueResults.label_is_not_a_reference_answer",
});
const READINESS_NOTE: Record<RowReadiness, string> = lazyMessages({
  ready: "",
  needs_resolution: "queueResults.reviewers_disagree_resolve_it_to_promote",
  not_reviewed: "queueResults.not_fully_reviewed_yet",
  not_a_trace: "queueResults.run_items_cannot_be_promoted_from",
});

const api = useTraceApi();
const route = useRoute();
const $q = useQuasar();
const experimentId = computed(() => route.params.experimentId as string);

const onlyDisagreements = ref(false);
const results = useAsync((signal) => api.getQueueResults(props.queueId, { onlyDisagreements: onlyDisagreements.value, limit: 200 }, signal));
const datasets = useAsync((signal) => api.listDatasets(signal));
void results.run();
void datasets.run();
watch(onlyDisagreements, () => void results.run());

const configs = computed(() => results.data.value?.configs ?? []);
const rows = computed(() => results.data.value?.items ?? []);
const configById = computed(() => new Map(configs.value.map((c) => [c.id, c])));
const categorical = computed(() => configs.value.filter((c) => c.dataType === "categorical" && !c.archivedAt));
const datasetOptions = computed(() => (datasets.data.value?.items ?? []).map((d) => ({ label: d.name, value: d.id })));
const REPLY = "__reply";
const referenceOptions = computed(() => [
  { label: t("queueResults.expected_output_only_the_correct_answer"), value: "" },
  { label: t("queueResults.expected_output_the_reply_that_was"), value: REPLY },
  ...categorical.value.map((c) => ({ label: t("queueResults.expected_output_the_label_of_name", { name: c.name }), value: c.id })),
]);

const openRow = ref<string | null>(null);
const openedRow = computed(() => rows.value.find((r) => r.id === openRow.value));
const drafts = reactive<Record<string, { value: string; expected: string }>>({});
const selected = reactive(new Set<string>());
const datasetId = ref<string | null>(null);
const referenceId = ref("");
const busy = ref(false);

const readyRows = computed(() => rows.value.filter((r) => rowReadiness(r) === "ready"));
const chosen = computed(() => rows.value.filter((r) => selected.has(r.id) && rowReadiness(r) === "ready"));
const referenceHelp = computed(() => {
  if (useReply.value) return t("queueResults.rows_where_you_typed_a_correct");
  if (reference.value) return t("queueResults.rows_where_you_typed_a_correct2", { name: reference.value.name });
  return t("queueResults.only_the_correct_answers_you_typed");
});
const promoteHint = computed(() => {
  if (!readyRows.value.length) return t("queueResults.no_row_is_ready_every_row");
  if (!chosen.value.length) return t("queueResults.tick_the_rows_to_add_or");
  if (!datasetId.value) return t("queueResults.choose_a_dataset_to_enable_add");
  return "";
});
const useReply = computed(() => referenceId.value === REPLY);
const reference = computed(() => categorical.value.find((c) => c.id === referenceId.value));
const canPromote = computed(() => !!datasetId.value && chosen.value.length > 0 && !busy.value);

const key = (row: QueueResultItemDto, configId: string) => `${row.id}:${configId}`;

function notifyError(action: string, error: unknown) {
  $q.notify({ message: `${action}: ${error instanceof Error ? error.message : String(error)}`, color: "negative", timeout: 5000 });
}

function show(config: ScoreConfigDto | undefined, value: string): string {
  return (config && valueChoices(config)?.find((c) => c.value === value)?.label) ?? value;
}

function toggle(row: QueueResultItemDto) {
  if (selected.has(row.id)) selected.delete(row.id);
  else selected.add(row.id);
}

function open(row: QueueResultItemDto) {
  openRow.value = row.id;
  for (const c of row.criteria) {
    drafts[key(row, c.configId)] ??= { value: c.resolution?.value ?? "", expected: c.resolution?.expectedOutput ?? "" };
  }
}

async function save(row: QueueResultItemDto, criterion: QueueResultCriterionDto) {
  const draft = drafts[key(row, criterion.configId)];
  if (!draft?.value) return;
  try {
    await api.resolveQueueItem(props.queueId, row.id, criterion.configId, { value: draft.value, expectedOutput: draft.expected.trim() || null });
    await results.run();
  } catch (error) {
    notifyError(t("queueResults.could_not_save_the_resolution"), error);
  }
}

async function clear(row: QueueResultItemDto, criterion: QueueResultCriterionDto) {
  try {
    await api.clearQueueResolution(props.queueId, row.id, criterion.configId);
    drafts[key(row, criterion.configId)] = { value: "", expected: "" };
    await results.run();
  } catch (error) {
    notifyError(t("queueResults.could_not_clear_the_resolution"), error);
  }
}

async function promote() {
  if (!datasetId.value) return;
  busy.value = true;
  let added = 0;
  const skipped: Array<{ reason: PromotionSkipReasonDto }> = [];
  try {
    for (const body of promotionBatches(chosen.value, reference.value, props.queueId, useReply.value)) {
      const result = await api.promoteTracesToDataset(datasetId.value, body);
      added += result.added.length;
      skipped.push(...result.skipped);
    }
    const detail = Object.entries(countSkipReasons(skipped)).map(([reason, n]) => `${n} ${REASONS[reason as PromotionSkipReasonDto]}`).join(", ");
    $q.notify({ message: `${tp("queueResults.itemsAdded", added)}${detail ? ` · ${t("queueResults.skipped_detail", { detail })}` : ""}`, color: added ? "positive" : "warning", timeout: 6000 });
    selected.clear();
  } catch (error) {
    notifyError(`${t("queueResults.could_not_add_to_the_dataset")}${added ? ` (${t("queueResults.count_already_added", { count: added })})` : ""}`, error);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="results" data-testid="queue-results">
    <p class="intro" data-testid="results-intro">
      <strong>{{ t("queueResults.your_task") }}</strong>{{ " " + t("queueResults.1_settle_every_disagreement") }}<em>{{ t("queueResults.resolve") }}</em>{{ t("queueResults.2_tick_the_rows_that_are") + " " }}<em>{{ t("queueResults.add_to_dataset") }}</em>{{ t("queueResults.open_a_row_to_read_the") }}
    </p>
    <div class="toolbar">
      <Checkbox class="check" v-model="onlyDisagreements" data-testid="only-disagreements">{{ " " + t("queueResults.only_disagreements") }}</Checkbox>
      <span v-if="results.data.value" class="muted">{{ tp("queueResults.items", results.data.value.total) }}</span>
      <Button class="push" size="sm" :disabled="!readyRows.length" data-testid="select-ready" @click="readyRows.forEach((r) => selected.add(r.id))">{{ t("queueResults.select_all_ready") }}</Button>
    </div>

    <ErrorBanner v-if="results.error.value" :error="results.error.value" @retry="results.run()" />
    <LoadingState v-else-if="!results.data.value" size="md" />
    <p v-else-if="!rows.length" class="muted" data-testid="results-empty">{{ onlyDisagreements ? t("queueResults.no_items_where_reviewers_disagree") : t("queueResults.no_items_in_this_queue_yet") }}</p>

    <div v-else class="scroll">
      <DataTable sticky density="sm">
        <thead>
          <tr>
            <th />
            <th>{{ t("queueResults.item") }}</th>
            <th v-for="c in configs" :key="c.id">{{ c.name }}</th>
            <th />
          </tr>
        </thead>
        <tbody v-for="row in rows" :key="row.id">
          <tr data-testid="result-row" :class="{ flagged: row.needsResolution }">
            <td><Checkbox :checked="selected.has(row.id)" :disabled="rowReadiness(row) !== 'ready'" :aria-label="t('queueResults.select_id', { id: shortId(row.traceId ?? row.id) })" data-testid="result-select" @change="toggle(row)" /></td>
            <td>
              <router-link v-if="row.traceId" :to="{ name: 'trace', params: { experimentId, traceId: row.traceId } }" class="mono" @click="emit('close')">{{ t('queueResults.trace_id', { id: shortId(row.traceId) }) }}</router-link>
              <span v-else class="mono">{{ t('queueResults.run_id_item_index', { id: shortId(row.datasetRunId ?? ""), index: row.itemIndex }) }}</span>
              <div v-for="p in row.promotedTo" :key="p.datasetId" class="note" data-testid="promoted-to">
                <router-link :to="{ name: 'dataset', params: { datasetId: p.datasetId } }" @click="emit('close')">→ {{ p.datasetName }} v{{ p.version }}</router-link>
              </div>
              <div class="muted note" :title="row.status === 'skipped' ? UNREVIEWABLE_NOTE : undefined">{{ row.status === "skipped" ? t("queueResults.unreviewable") : row.status }}<template v-if="READINESS_NOTE[rowReadiness(row)] && row.status === 'completed'"> · {{ READINESS_NOTE[rowReadiness(row)] }}</template></div>
              <div v-if="row.status === 'skipped'" class="muted note">{{ UNREVIEWABLE_NOTE }}</div>
            </td>
            <td v-for="c in configs" :key="c.id" :class="{ disagree: row.criteria.find((x) => x.configId === c.id)?.status === 'disagreement' }">
              <template v-for="crit in row.criteria.filter((x) => x.configId === c.id)" :key="crit.configId">
                <span v-if="!crit.labels.length" class="muted">—</span>
                <span v-for="l in crit.labels" :key="l.userId" class="lbl" :class="{ muted: !l.isReviewer }" :title="[l.comment, l.isReviewer ? '' : t('queueResults.no_longer_a_reviewer')].filter(Boolean).join(' · ')">
                  {{ l.name ?? t("queueResults.former_member") }}: <strong>{{ show(c, l.value) }}</strong>
                </span>
                <Pill v-if="crit.resolution" tone="ok" data-testid="resolved-pill">{{ t('queueResults.resolved_value', { value: show(c, crit.resolution.value) }) }}</Pill>
                <Pill v-else-if="crit.status === 'disagreement'" tone="warn">{{ t("queueResults.disagreement") }}</Pill>
              </template>
            </td>
            <td><Button size="sm" data-testid="resolve-btn" @click="open(row)">{{ row.needsResolution ? t("queueResults.resolve") : t("queueResults.open") }}</Button></td>
          </tr>

        </tbody>
      </DataTable>
    </div>

    <div v-if="rows.length" class="promote" data-testid="promote-bar">
      <strong>{{ t("queueResults.count_selected", { count: chosen.length }) }}</strong>
      <Select v-model="datasetId" :options="datasetOptions" :placeholder="t('queueResults.choose_a_dataset')" :aria-label="t('queueResults.dataset')" data-testid="promote-dataset" />
      <Select v-model="referenceId" :options="referenceOptions" :aria-label="t('queueResults.expected_output_from')" data-testid="promote-config" />
      <Button variant="primary" size="sm" data-testid="promote-run" :disabled="!canPromote" @click="promote">{{ t("queueResults.add_to_dataset") }}</Button>
      <p class="muted" data-testid="promote-help">{{ referenceHelp }}</p>
      <p v-if="promoteHint" class="muted hint" data-testid="promote-hint">{{ promoteHint }}</p>
      <p class="muted">{{ t("queueResults.items_are_copies_and_each_batch") }}</p>
    </div>

    <Modal v-if="openedRow" full :title="openedRow.traceId ? t('queueResults.trace_id', { id: shortId(openedRow.traceId) }) : t('queueResults.run_item_index', { index: openedRow.itemIndex })" @close="openRow = null">
      <div class="split" data-testid="resolve-panel">
        <div class="conversation">
          <h3>{{ t("queueResults.conversation_that_was_evaluated") }}</h3>
          <TraceThreadPreview v-if="openedRow.traceId" :trace-id="openedRow.traceId" fill />
        </div>
        <div class="decisions">
          <p class="muted">{{ t("queueResults.each_reviewer_s_answer_and_your") }}</p>
          <div v-for="crit in openedRow.criteria" :key="crit.configId" class="crit">
            <h4>{{ configById.get(crit.configId)?.name }}</h4>
            <p v-if="configById.get(crit.configId)?.description" class="muted">{{ configById.get(crit.configId)?.description }}</p>
            <ul class="plain">
              <li v-for="l in crit.labels" :key="l.userId"><strong>{{ l.name ?? t("queueResults.former_member") }}</strong> {{ show(configById.get(crit.configId), l.value) }}<span v-if="l.comment" class="muted"> — “{{ l.comment }}”</span></li>
              <li v-if="!crit.labels.length" class="muted">{{ t("queueResults.nobody_labelled_this_criterion") }}</li>
            </ul>
            <div v-if="drafts[key(openedRow, crit.configId)] && configById.get(crit.configId)" class="decide">
              <span class="muted">{{ t("queueResults.verdict_settles_the_disagreement") }}</span>
              <template v-if="valueChoices(configById.get(crit.configId)!)">
                <ToggleChip
                  v-for="c in valueChoices(configById.get(crit.configId)!)"
                  :key="c.value"
                  class="choice"
                  :pressed="drafts[key(openedRow, crit.configId)]!.value === c.value"
                  data-testid="choice"
                  @click="drafts[key(openedRow, crit.configId)]!.value = c.value"
                >{{ c.label }}</ToggleChip>
              </template>
              <TextInput v-else v-model="drafts[key(openedRow, crit.configId)]!.value" type="number" :aria-label="t('queueResults.final_value')" />
            </div>
            <TextInput multiline class="expected" v-if="drafts[key(openedRow, crit.configId)]" v-model="drafts[key(openedRow, crit.configId)]!.expected" :rows="3" :placeholder="t('queueResults.correct_answer_optional_what_the_agent')" :aria-label="t('queueResults.correct_answer')" />
            <div class="decide">
              <Button size="sm" :disabled="!drafts[key(openedRow, crit.configId)]?.value" data-testid="save-resolution" @click="save(openedRow, crit)">{{ t("queueResults.save_decision") }}</Button>
              <Button size="sm" v-if="crit.resolution" data-testid="clear-resolution" @click="clear(openedRow, crit)">{{ t("queueResults.clear_decision") }}</Button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  </section>
</template>

<style scoped>
.intro {
  margin: 0 0 10px;
  padding: 8px 12px;
  border-radius: var(--mt-radius-sm);
  background: var(--mt-soft);
  font-size: 12.5px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
}
.muted {
  color: var(--mt-muted);
  font-size: 12.5px;
  margin: 4px 0 0;
}
.note {
  margin: 2px 0 0;
  font-size: 11.5px;
}
.scroll {
  max-height: 420px;
  overflow: auto;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-lg);
}

tr.flagged td:first-child {
  box-shadow: inset 3px 0 0 var(--mt-err-ink);
}
td.disagree {
  background: color-mix(in srgb, var(--mt-err-ink) 8%, transparent);
}
.lbl {
  display: block;
  white-space: nowrap;
}
.split {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(320px, 2fr);
  gap: 20px;
}
.conversation {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.conversation h3 {
  margin: 0 0 8px;
  font-size: 12.5px;
}
.conversation :deep(.preview) {
  flex: 1;
  min-height: 0;
}
.decisions {
  min-height: 0;
  overflow: auto;
}
@media (max-width: 900px) {
  .split {
    grid-template-columns: 1fr;
    overflow: auto;
  }
}
.crit {
  padding: 8px 0;
}
.crit + .crit {
  border-top: 1px solid var(--mt-line);
}
h4 {
  margin: 0 0 4px;
  font-size: 12.5px;
}
.plain {
  list-style: none;
  margin: 0 0 6px;
  padding: 0;
}
.decide {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 6px 0;
}
.promote {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.promote .hint {
  color: var(--mt-accent);
  font-weight: 600;
}
.promote .muted {
  flex-basis: 100%;
  margin: 0;
}
select {
  height: 28px;
  border-radius: var(--mt-radius-sm);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  color: var(--mt-ink);
  font: inherit;
  font-size: 12.5px;
}

.push { margin-left: auto; }
</style>
