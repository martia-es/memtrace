<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
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

/**
 * Resultados de una cola para el perfil técnico (ADR-050): qué respondió cada revisor por item y criterio, los
 * desacuerdos, la resolución del técnico (capa aparte, no toca las etiquetas) y la promoción de lo elegido a un dataset.
 */
const props = defineProps<{ queueId: string }>();
const emit = defineEmits<{ close: [] }>();

const UNREVIEWABLE_NOTE = "Marked unreviewable by a reviewer (not enough content to judge): it can't be added to a dataset";
const REASONS: Record<PromotionSkipReasonDto, string> = {
  already_promoted: "already in the dataset",
  no_content: "no input saved",
  not_found: "not found",
  ambiguous_label: "reviewers disagree",
  unsupported_label: "label is not a reference answer",
};
const READINESS_NOTE: Record<RowReadiness, string> = {
  ready: "",
  needs_resolution: "Reviewers disagree: resolve it to promote",
  not_reviewed: "Not fully reviewed yet",
  not_a_trace: "Run items cannot be promoted from here",
};

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
const referenceOptions = computed(() => [
  { label: "Expected output: only what I typed", value: "" },
  ...categorical.value.map((c) => ({ label: `Expected output from “${c.name}”`, value: c.id })),
]);

const openRow = ref<string | null>(null);
const drafts = reactive<Record<string, { value: string; expected: string }>>({});
const selected = reactive(new Set<string>());
const datasetId = ref<string | null>(null);
const referenceId = ref("");
const busy = ref(false);

const readyRows = computed(() => rows.value.filter((r) => rowReadiness(r) === "ready"));
const chosen = computed(() => rows.value.filter((r) => selected.has(r.id) && rowReadiness(r) === "ready"));
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
  openRow.value = openRow.value === row.id ? null : row.id;
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
    notifyError("Could not save the resolution", error);
  }
}

async function clear(row: QueueResultItemDto, criterion: QueueResultCriterionDto) {
  try {
    await api.clearQueueResolution(props.queueId, row.id, criterion.configId);
    drafts[key(row, criterion.configId)] = { value: "", expected: "" };
    await results.run();
  } catch (error) {
    notifyError("Could not clear the resolution", error);
  }
}

async function promote() {
  if (!datasetId.value) return;
  busy.value = true;
  let added = 0;
  const skipped: Array<{ reason: PromotionSkipReasonDto }> = [];
  try {
    for (const body of promotionBatches(chosen.value, reference.value, props.queueId)) {
      const result = await api.promoteTracesToDataset(datasetId.value, body);
      added += result.added.length;
      skipped.push(...result.skipped);
    }
    const detail = Object.entries(countSkipReasons(skipped)).map(([reason, n]) => `${n} ${REASONS[reason as PromotionSkipReasonDto]}`).join(", ");
    $q.notify({ message: `Added ${added} item${added === 1 ? "" : "s"} to the dataset${detail ? ` · skipped: ${detail}` : ""}`, color: added ? "positive" : "warning", timeout: 6000 });
    selected.clear();
  } catch (error) {
    notifyError(`Could not add to the dataset${added ? ` (${added} already added)` : ""}`, error);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="results" data-testid="queue-results">
    <p class="intro" data-testid="results-intro">
      <strong>Your task:</strong> check what reviewers answered, settle any disagreement, then tick the good rows and add them to a dataset.
      Open a row to read the conversation that was evaluated next to the reviewers' answers.
    </p>
    <div class="toolbar">
      <label class="check"><input v-model="onlyDisagreements" type="checkbox" data-testid="only-disagreements" /> Only disagreements</label>
      <span v-if="results.data.value" class="muted">{{ results.data.value.total }} item{{ results.data.value.total === 1 ? "" : "s" }}</span>
      <button type="button" class="small-btn" :disabled="!readyRows.length" data-testid="select-ready" @click="readyRows.forEach((r) => selected.add(r.id))">Select all ready</button>
    </div>

    <ErrorBanner v-if="results.error.value" :error="results.error.value" @retry="results.run()" />
    <div v-else-if="!results.data.value" class="loading"><q-spinner size="24px" color="primary" /></div>
    <p v-else-if="!rows.length" class="muted" data-testid="results-empty">{{ onlyDisagreements ? "No items where reviewers disagree." : "No items in this queue yet." }}</p>

    <div v-else class="scroll">
      <table>
        <thead>
          <tr>
            <th />
            <th>Item</th>
            <th v-for="c in configs" :key="c.id">{{ c.name }}</th>
            <th />
          </tr>
        </thead>
        <tbody v-for="row in rows" :key="row.id">
          <tr data-testid="result-row" :class="{ flagged: row.needsResolution }">
            <td><input type="checkbox" :checked="selected.has(row.id)" :disabled="rowReadiness(row) !== 'ready'" :aria-label="`Select ${shortId(row.traceId ?? row.id)}`" data-testid="result-select" @change="toggle(row)" /></td>
            <td>
              <router-link v-if="row.traceId" :to="{ name: 'trace', params: { experimentId, traceId: row.traceId } }" class="mono" @click="emit('close')">Trace {{ shortId(row.traceId) }}</router-link>
              <span v-else class="mono">Run {{ shortId(row.datasetRunId ?? "") }} · item {{ row.itemIndex }}</span>
              <div v-for="p in row.promotedTo" :key="p.datasetId" class="note" data-testid="promoted-to">
                <router-link :to="{ name: 'dataset', params: { datasetId: p.datasetId } }" @click="emit('close')">→ {{ p.datasetName }} v{{ p.version }}</router-link>
              </div>
              <div class="muted note" :title="row.status === 'skipped' ? UNREVIEWABLE_NOTE : undefined">{{ row.status === "skipped" ? "unreviewable" : row.status }}<template v-if="READINESS_NOTE[rowReadiness(row)] && row.status === 'completed'"> · {{ READINESS_NOTE[rowReadiness(row)] }}</template></div>
              <div v-if="row.status === 'skipped'" class="muted note">{{ UNREVIEWABLE_NOTE }}</div>
            </td>
            <td v-for="c in configs" :key="c.id" :class="{ disagree: row.criteria.find((x) => x.configId === c.id)?.status === 'disagreement' }">
              <template v-for="crit in row.criteria.filter((x) => x.configId === c.id)" :key="crit.configId">
                <span v-if="!crit.labels.length" class="muted">—</span>
                <span v-for="l in crit.labels" :key="l.userId" class="lbl" :class="{ muted: !l.isReviewer }" :title="[l.comment, l.isReviewer ? '' : 'No longer a reviewer'].filter(Boolean).join(' · ')">
                  {{ l.name ?? "Former member" }}: <strong>{{ show(c, l.value) }}</strong>
                </span>
                <span v-if="crit.resolution" class="pill ok" data-testid="resolved-pill">resolved: {{ show(c, crit.resolution.value) }}</span>
                <span v-else-if="crit.status === 'disagreement'" class="pill warn">disagreement</span>
              </template>
            </td>
            <td><button type="button" class="small-btn" data-testid="resolve-btn" @click="open(row)">{{ openRow === row.id ? "Close" : row.needsResolution ? "Resolve" : "Open" }}</button></td>
          </tr>

          <tr v-if="openRow === row.id" class="panel" data-testid="resolve-panel">
            <td :colspan="configs.length + 3">
              <TraceThreadPreview v-if="row.traceId" :trace-id="row.traceId" />
              <p class="muted">Reviewers' answers and your final decision. Saving a decision never changes what reviewers answered.</p>
              <div v-for="crit in row.criteria" :key="crit.configId" class="crit">
                <h4>{{ configById.get(crit.configId)?.name }}</h4>
                <ul class="plain">
                  <li v-for="l in crit.labels" :key="l.userId"><strong>{{ l.name ?? "Former member" }}</strong> {{ show(configById.get(crit.configId), l.value) }}<span v-if="l.comment" class="muted"> — “{{ l.comment }}”</span></li>
                  <li v-if="!crit.labels.length" class="muted">Nobody labelled this criterion.</li>
                </ul>
                <div v-if="drafts[key(row, crit.configId)] && configById.get(crit.configId)" class="decide">
                  <span class="muted">Your final value</span>
                  <template v-if="valueChoices(configById.get(crit.configId)!)">
                    <button
                      v-for="c in valueChoices(configById.get(crit.configId)!)"
                      :key="c.value"
                      type="button"
                      class="choice"
                      :class="{ on: drafts[key(row, crit.configId)]!.value === c.value }"
                      data-testid="choice"
                      @click="drafts[key(row, crit.configId)]!.value = c.value"
                    >{{ c.label }}</button>
                  </template>
                  <TextInput v-else v-model="drafts[key(row, crit.configId)]!.value" type="number" aria-label="Final value" />
                </div>
                <TextInput multiline class="expected" v-if="drafts[key(row, crit.configId)]" v-model="drafts[key(row, crit.configId)]!.expected" :rows="2" placeholder="Correct answer (optional): what the agent should have said" aria-label="Expected output" />
                <div class="decide">
                  <button type="button" class="small-btn" :disabled="!drafts[key(row, crit.configId)]?.value" data-testid="save-resolution" @click="save(row, crit)">Save decision</button>
                  <button v-if="crit.resolution" type="button" class="small-btn" data-testid="clear-resolution" @click="clear(row, crit)">Clear decision</button>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="rows.length" class="promote" data-testid="promote-bar">
      <strong>{{ chosen.length }} selected</strong>
      <Select v-model="datasetId" :options="datasetOptions" placeholder="Choose a dataset…" aria-label="Dataset" data-testid="promote-dataset" />
      <Select v-model="referenceId" :options="referenceOptions" aria-label="Expected output from" data-testid="promote-config" />
      <button type="button" class="small-btn primary" data-testid="promote-run" :disabled="!canPromote" @click="promote">Add to dataset</button>
      <p class="muted">Items are copies and each batch of 100 creates one new dataset version. Rows where reviewers disagree can’t be selected until you resolve them.</p>
    </div>
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
.toolbar .small-btn {
  margin-left: auto;
}
.check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
}
.loading {
  display: flex;
  justify-content: center;
  padding: 24px;
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
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
th {
  position: sticky;
  top: 0;
  background: var(--mt-soft);
  color: var(--mt-muted);
  font-size: 11.5px;
  text-align: left;
  padding: 6px 10px;
}
td {
  padding: 6px 10px;
  border-top: 1px solid var(--mt-line);
  vertical-align: top;
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
.pill {
  display: inline-block;
  margin-top: 2px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--mt-card);
  font-size: 11px;
  font-weight: 600;
}
.pill.ok {
  color: var(--mt-ok-ink, var(--mt-accent));
}
.pill.warn {
  color: var(--mt-err-ink);
}
.panel td {
  background: var(--mt-soft);
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
.choice {
  height: 26px;
  padding: 0 10px;
  border-radius: var(--mt-radius-sm);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  color: var(--mt-ink);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.choice.on {
  border-color: var(--mt-accent);
  color: var(--mt-accent);
  font-weight: 700;
}
.promote {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
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
.small-btn {
  height: 28px;
  padding: 0 12px;
  border-radius: var(--mt-radius-sm);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  color: var(--mt-ink);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.small-btn.primary {
  border-color: var(--mt-accent);
  color: var(--mt-accent);
}
.small-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
