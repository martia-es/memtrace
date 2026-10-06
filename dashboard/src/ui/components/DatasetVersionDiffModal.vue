<script setup lang="ts">
import Select from "./Select.vue";
import type { DatasetItemChangeDto, DatasetVersionDto } from "@contract";
import { computed, ref, watch } from "vue";
import { formatDateTime } from "@/domain/format";
import { itemDiffText, sideBySideDiff } from "@/domain/text-diff";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";
import ErrorBanner from "./ErrorBanner.vue";
import Modal from "./Modal.vue";

const props = defineProps<{
  datasetId: string;
  version: DatasetVersionDto;
  /** Todas las versiones del dataset, más reciente primero (ADR-033). */
  versions: DatasetVersionDto[];
}>();
const emit = defineEmits<{ close: [] }>();

const api = useTraceApi();

const olderVersions = computed(() => {
  const index = props.versions.findIndex((v) => v.id === props.version.id);
  return index === -1 ? [] : props.versions.slice(index + 1);
});
// por defecto se compara con la inmediatamente anterior, como un `git show`
const againstId = ref<string>(olderVersions.value[0]?.id ?? "");

const diff = useAsync((signal) => api.getDatasetVersionDiff(props.datasetId, props.version.id, againstId.value || undefined, signal));
watch(againstId, () => void diff.run(), { immediate: true });

const label = (v: { major: number; minor: number }) => `v${v.major}.${v.minor}`;
const versionOptions = computed(() => olderVersions.value.map((v) => ({ label: `${label(v)}${v.note ? ` — ${v.note}` : ""}`, value: v.id })));

const entries = computed(() =>
  (diff.data.value?.changes ?? []).map((change) => ({
    change,
    rows: sideBySideDiff(change.kind === "added" || !change.before ? "" : itemDiffText(change.before), change.kind === "removed" || !change.after ? "" : itemDiffText(change.after)),
  })),
);

function changeAuthor(change: DatasetItemChangeDto): string {
  const { after } = change;
  if (change.kind === "added") return after ? `${after.createdByEmail} · ${formatDateTime(after.createdAt)}` : "";
  if (change.kind === "modified") return after?.updatedByEmail && after.updatedAt ? `${after.updatedByEmail} · ${formatDateTime(after.updatedAt)}` : "";
  return after?.deletedByEmail && after.deletedAt ? `${after.deletedByEmail} · ${formatDateTime(after.deletedAt)}` : "";
}
const KIND_LABEL = { added: "Added", modified: "Modified", removed: "Removed" } as const;
const KIND_TONE = { added: "ok", modified: "warn", removed: "error" } as const;
</script>

<template>
  <Modal :title="`Version ${label(version)}`" wide @close="emit('close')">
    <dl class="meta">
      <div><dt>Change</dt><dd>{{ version.note ?? "–" }}</dd></div>
      <div><dt>By</dt><dd>{{ version.createdByEmail }}</dd></div>
      <div><dt>When</dt><dd class="mono">{{ formatDateTime(version.createdAt) }}</dd></div>
      <div>
        <dt><label for="compare-with">Compare with</label></dt>
        <dd>
          <Select v-if="olderVersions.length > 0" id="compare-with" v-model="againstId" :options="versionOptions" />
          <span v-else class="muted">Initial version</span>
        </dd>
      </div>
    </dl>

    <ErrorBanner v-if="diff.error.value" :error="diff.error.value" @retry="diff.run()" />
    <div v-else-if="diff.loading.value && !diff.data.value" class="loading"><q-spinner size="28px" color="primary" /></div>
    <template v-else-if="diff.data.value">
      <p v-if="diff.data.value.base" class="muted range">Changes from {{ label(diff.data.value.base) }} to {{ label(diff.data.value.target) }} — everything that differs between the two, including changes made by versions in between.</p>
      <p v-if="entries.length === 0" class="muted empty">No differences{{ diff.data.value.base ? ` between ${label(diff.data.value.base)} and ${label(diff.data.value.target)}` : "" }}.</p>
      <section v-for="entry in entries" :key="entry.change.originItemId" class="change" data-testid="diff-change">
        <header class="change-head">
          <span class="mt-pill" :class="KIND_TONE[entry.change.kind]">{{ KIND_LABEL[entry.change.kind] }}{{ diff.data.value.base ? ` since ${label(diff.data.value.base)}` : "" }}</span>
          <span class="muted">{{ changeAuthor(entry.change) }}</span>
        </header>
        <div class="diff">
          <div class="side-title">{{ diff.data.value.base ? label(diff.data.value.base) : "–" }}</div>
          <div class="side-title">{{ label(diff.data.value.target) }}</div>
          <template v-for="(row, i) in entry.rows" :key="i">
            <pre class="line" :class="row.left.kind">{{ row.left.text }}</pre>
            <pre class="line" :class="row.right.kind">{{ row.right.text }}</pre>
          </template>
        </div>
      </section>
      <p v-if="diff.data.value.unchangedCount > 0" class="muted unchanged">{{ diff.data.value.unchangedCount }} unchanged item{{ diff.data.value.unchangedCount === 1 ? "" : "s" }}</p>
    </template>
  </Modal>
</template>

<style scoped>
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 28px;
  margin: 0;
  font-size: 13px;
}
.meta dt {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--mt-muted);
}
.meta dd {
  margin: 2px 0 0;
}
.compare-select {
  font: inherit;
  padding: 3px 6px;
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  color: var(--mt-ink);
}
.loading,
.empty {
  display: flex;
  justify-content: center;
  padding: 16px;
}
.change {
  border: 1px solid var(--mt-line);
}
.change-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: var(--mt-soft-2);
  font-size: 12.5px;
}
.diff {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}
.side-title {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--mt-muted);
  border-bottom: 1px solid var(--mt-line);
}
.side-title + .side-title {
  border-left: 1px solid var(--mt-line);
}
.line {
  margin: 0;
  padding: 0 10px;
  min-height: 1.5em;
  font: 12px/1.5 var(--mt-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.line:nth-child(odd) {
  border-left: none;
}
.line:nth-child(even) {
  border-left: 1px solid var(--mt-line);
}
.line.del {
  background: var(--mt-err-bg);
  color: var(--mt-err-ink);
}
.line.add {
  background: var(--mt-ok-bg);
  color: var(--mt-ok-ink);
}
.line.empty {
  background: var(--mt-soft);
}
.range {
  margin: 0;
  font-size: 12.5px;
}
.unchanged {
  margin: 0;
  font-size: 12.5px;
}
</style>
