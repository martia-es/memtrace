<script setup lang="ts">
import type { DatasetItemDto } from "@contract";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { useQuasar } from "quasar";
import { formatDateTime } from "@/domain/format";
import { blankRow, buildCommit, isDirty, nextVersionLabel, pasteGrid, parseClipboardGrid, rowProblem, rowState, rowsFromItems, summarize, type DraftRow } from "../dataset-draft";
import Modal from "./Modal.vue";
import { useTraceApi } from "../composables/useTraceApi";

/**
 * Editor de items estilo hoja de cálculo (ADR-041): se edita en la propia tabla, todo queda en un
 * borrador y "Publish" lo guarda como UNA sola versión con un resumen automático de lo que cambió.
 */
const props = defineProps<{ datasetId: string; items: DatasetItemDto[]; version: { major: number; minor: number } | null }>();
const emit = defineEmits<{ published: [] }>();

const api = useTraceApi();
const $q = useQuasar();
const root = ref<HTMLElement | null>(null);

const rows = ref<DraftRow[]>(rowsFromItems(props.items));
const itemsById = computed(() => new Map(props.items.map((i) => [i.id, i])));
const search = ref("");
const selected = ref<Set<string>>(new Set());
const detailKey = ref<string | null>(null);
const publishing = ref(false);

const summary = computed(() => summarize(rows.value));
const dirty = computed(() => isDirty(rows.value));
const changeCount = computed(() => summary.value.added + summary.value.edited + summary.value.removed);
const nextLabel = computed(() => nextVersionLabel(props.version ?? { major: 1, minor: 0 }, summary.value));
const detailRow = computed(() => rows.value.find((r) => r.key === detailKey.value) ?? null);

// el servidor solo "gana" sobre el borrador si no hay cambios sin publicar
watch(
  () => props.items,
  (items) => {
    if (!dirty.value) rows.value = rowsFromItems(items);
  },
);

const visibleRows = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return rows.value;
  return rows.value.filter((r) => rowState(r) === "empty" || r.input.toLowerCase().includes(q) || r.expected.toLowerCase().includes(q));
});

function ensureTrailingBlank() {
  const last = rows.value[rows.value.length - 1];
  if (!last || rowState(last) !== "empty") rows.value.push(blankRow());
}

function cell(key: string, col: 0 | 1): HTMLTextAreaElement | null {
  return root.value?.querySelector<HTMLTextAreaElement>(`[data-cell="${key}:${col}"]`) ?? null;
}

async function focusCell(key: string, col: 0 | 1) {
  await nextTick();
  cell(key, col)?.focus();
}

// Enter = bajar a la misma columna de la fila siguiente (como Excel); Shift+Enter = salto de línea dentro de la celda;
// Ctrl/Cmd+Enter = publicar.
function onKeydown(event: KeyboardEvent, row: DraftRow, col: 0 | 1) {
  if (event.key !== "Enter" || event.isComposing) return;
  if (event.metaKey || event.ctrlKey) {
    event.preventDefault();
    void publish();
    return;
  }
  if (event.shiftKey) return;
  event.preventDefault();
  const list = visibleRows.value.filter((r) => !r.removed);
  const next = list[list.indexOf(row) + 1];
  if (next) void focusCell(next.key, col);
}

function onPaste(event: ClipboardEvent, row: DraftRow, col: 0 | 1) {
  const text = event.clipboardData?.getData("text/plain") ?? "";
  if (!/[\t\n]/.test(text.replace(/\n$/, ""))) return; // un texto normal se pega normal
  event.preventDefault();
  const grid = parseClipboardGrid(text.replace(/\r?\n$/, ""));
  rows.value = pasteGrid(rows.value, rows.value.indexOf(row), col, grid);
  $q.notify({ message: `Pasted ${grid.length} row${grid.length === 1 ? "" : "s"}`, timeout: 1500 });
}

function remove(row: DraftRow) {
  selected.value.delete(row.key);
  if (row.id === null) rows.value = rows.value.filter((r) => r !== row);
  else row.removed = true;
  ensureTrailingBlank();
}

function restore(row: DraftRow) {
  row.removed = false;
}

function duplicate(row: DraftRow) {
  rows.value.splice(rows.value.indexOf(row) + 1, 0, blankRow({ input: row.input, expected: row.expected, metadata: row.metadata }));
}

function revert(row: DraftRow) {
  if (row.original) Object.assign(row, row.original);
}

const selectableRows = computed(() => visibleRows.value.filter((r) => rowState(r) !== "empty" && !r.removed));
const allSelected = computed(() => selectableRows.value.length > 0 && selectableRows.value.every((r) => selected.value.has(r.key)));

function toggleAll() {
  selected.value = allSelected.value ? new Set() : new Set(selectableRows.value.map((r) => r.key));
}

function toggle(row: DraftRow) {
  const next = new Set(selected.value);
  if (!next.delete(row.key)) next.add(row.key);
  selected.value = next;
}

function removeSelected() {
  for (const row of rows.value.filter((r) => selected.value.has(r.key))) remove(row);
  selected.value = new Set();
}

function duplicateSelected() {
  for (const row of rows.value.filter((r) => selected.value.has(r.key)).reverse()) duplicate(row);
  selected.value = new Set();
}

function discard() {
  rows.value = rowsFromItems(props.items);
  selected.value = new Set();
}

async function publish() {
  if (!dirty.value || publishing.value) return;
  if (summary.value.problems > 0) {
    $q.notify({ message: "Fix the highlighted rows before publishing", color: "negative", timeout: 3000 });
    return;
  }
  publishing.value = true;
  const label = nextLabel.value;
  try {
    const response = await api.commitDatasetChanges(props.datasetId, buildCommit(rows.value));
    rows.value = rowsFromItems(response.items);
    selected.value = new Set();
    $q.notify({ message: `Published ${label}`, color: "positive", timeout: 2500 });
    emit("published");
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    $q.notify({ message: `Could not publish: ${detail}`, color: "negative", timeout: 5000 });
  } finally {
    publishing.value = false;
  }
}

function lastEdit(row: DraftRow): string {
  const item = row.id ? itemsById.value.get(row.id) : null;
  if (!item) return "";
  return item.updatedByEmail ? `${item.updatedByEmail} · ${formatDateTime(item.updatedAt!)}` : `${item.createdByEmail} · ${formatDateTime(item.createdAt)}`;
}

// cambios sin publicar: avisar antes de perderlos
function onBeforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value) event.preventDefault();
}
onMounted(() => window.addEventListener("beforeunload", onBeforeUnload));
onBeforeUnmount(() => window.removeEventListener("beforeunload", onBeforeUnload));
onBeforeRouteLeave(() => !dirty.value || window.confirm("You have unpublished changes. Leave and discard them?"));

defineExpose({ dirty });
</script>

<template>
  <div ref="root" class="editor">
    <div class="toolbar">
      <q-input v-model="search" dense outlined placeholder="Search items…" class="search" clearable>
        <template #prepend><q-icon name="search" size="18px" /></template>
      </q-input>
      <template v-if="selected.size > 0">
        <span class="muted">{{ selected.size }} selected</span>
        <button type="button" class="ghost-btn small" @click="duplicateSelected">Duplicate</button>
        <button type="button" class="ghost-btn small danger" @click="removeSelected">Delete</button>
      </template>
      <span class="spacer" />
      <span class="muted hint">Enter ↓ next row · Shift+Enter new line · paste cells from Excel/Sheets · ⌘/Ctrl+Enter publish</span>
    </div>

    <div class="mt-card table-card">
      <table class="items">
        <thead>
          <tr>
            <th class="check"><input type="checkbox" aria-label="Select all" :checked="allSelected" @change="toggleAll" /></th>
            <th class="idx">#</th>
            <th>Input</th>
            <th>Expected output</th>
            <th>Last edit</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in visibleRows" :key="row.key" class="item-row" :class="[`is-${rowState(row)}`, { problem: rowProblem(row) }]">
            <td class="check">
              <input v-if="rowState(row) !== 'empty' && !row.removed" type="checkbox" :checked="selected.has(row.key)" :aria-label="`Select row ${i + 1}`" @change="toggle(row)" />
            </td>
            <td class="idx mono muted">{{ rowState(row) === "empty" ? "+" : i + 1 }}</td>
            <td v-for="col in [0, 1] as const" :key="col" class="edit-cell">
              <textarea
                :data-cell="`${row.key}:${col}`"
                class="cell-input"
                rows="1"
                :disabled="row.removed"
                :value="col === 0 ? row.input : row.expected"
                :placeholder="rowState(row) === 'empty' ? (col === 0 ? 'Type here to add an item…' : '') : col === 0 ? 'Required' : 'Optional'"
                :aria-label="`${col === 0 ? 'Input' : 'Expected output'} of row ${i + 1}`"
                @input="(e) => { const v = (e.target as HTMLTextAreaElement).value; if (col === 0) row.input = v; else row.expected = v; ensureTrailingBlank(); }"
                @keydown="onKeydown($event, row, col)"
                @paste="onPaste($event, row, col)"
              ></textarea>
            </td>
            <td class="muted last-edit">
              <span v-if="row.id === null && rowState(row) !== 'empty'" class="badge new">new</span>
              <span v-else-if="rowState(row) === 'modified'" class="badge modified">edited</span>
              <span v-else-if="row.removed" class="badge removed">will be deleted</span>
              <template v-else>{{ lastEdit(row) }}</template>
              <div v-if="rowProblem(row)" class="problem-text">{{ rowProblem(row) }}</div>
            </td>
            <td class="row-actions">
              <template v-if="rowState(row) !== 'empty'">
                <button v-if="row.removed" type="button" class="ghost-btn small" @click="restore(row)">Restore</button>
                <template v-else>
                  <button v-if="rowState(row) === 'modified'" type="button" class="icon-btn" title="Undo changes to this row" aria-label="Undo changes to this row" @click="revert(row)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6M3.5 13a9 9 0 1 0 2.6-6.4L3 9" /></svg>
                  </button>
                  <button type="button" class="icon-btn" title="Details (metadata, audit)" aria-label="Details" @click="detailKey = row.key">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
                  </button>
                  <button type="button" class="icon-btn" title="Duplicate" aria-label="Duplicate" @click="duplicate(row)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></svg>
                  </button>
                  <button type="button" class="icon-btn danger" title="Delete" aria-label="Delete" @click="remove(row)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" /></svg>
                  </button>
                </template>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- barra de publicación: aparece solo con cambios sin publicar -->
    <div v-if="dirty" class="publish-bar mt-card" role="status">
      <div class="publish-summary">
        <strong>{{ changeCount }} unpublished change{{ changeCount === 1 ? "" : "s" }}</strong>
        <span v-if="summary.added" class="added">+{{ summary.added }} added</span>
        <span v-if="summary.edited" class="modified">~{{ summary.edited }} edited</span>
        <span v-if="summary.removed" class="removed">−{{ summary.removed }} deleted</span>
        <span class="muted">→ will be saved as one version, <b>{{ nextLabel }}</b></span>
      </div>
      <button type="button" class="ghost-btn" :disabled="publishing" @click="discard">Discard</button>
      <button type="button" class="primary-btn" :disabled="publishing || summary.problems > 0" @click="publish">{{ publishing ? "Publishing…" : `Publish ${nextLabel}` }}</button>
    </div>

    <Modal v-if="detailRow" title="Item details" @close="detailKey = null">
      <div class="modal-form">
        <label class="field-label" for="item-metadata">Metadata (JSON object, optional)</label>
        <textarea id="item-metadata" v-model="detailRow.metadata" class="text-area" rows="5" placeholder='{"source": "manual"}'></textarea>
        <div v-if="rowProblem(detailRow)" class="problem-text">{{ rowProblem(detailRow) }}</div>
        <template v-if="detailRow.id && itemsById.get(detailRow.id)">
          <label class="field-label">Audit</label>
          <p class="muted audit">
            Added by {{ itemsById.get(detailRow.id)!.createdByEmail }} · {{ formatDateTime(itemsById.get(detailRow.id)!.createdAt) }}<br />
            <template v-if="itemsById.get(detailRow.id)!.updatedByEmail">Last edited by {{ itemsById.get(detailRow.id)!.updatedByEmail }} · {{ formatDateTime(itemsById.get(detailRow.id)!.updatedAt!) }}</template>
            <template v-else>Never edited</template>
          </p>
        </template>
        <button type="button" class="primary-btn" @click="detailKey = null">Done</button>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.editor {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 12.5px;
}
.spacer {
  flex: 1;
}
.hint {
  font-size: 11.5px;
}
.search {
  width: 260px;
}
.muted {
  color: var(--mt-muted);
}
.table-card {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0;
}
.items {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 8px 12px;
  background: var(--mt-card, #fff);
  border-bottom: 1px solid var(--mt-line);
  color: var(--mt-muted);
  font-size: 12px;
  font-weight: 500;
  text-align: left;
  white-space: nowrap;
}
td {
  padding: 3px 6px;
  border-bottom: 1px solid var(--mt-line-2);
  vertical-align: top;
}
.check {
  width: 32px;
  text-align: center;
}
.idx {
  width: 36px;
  text-align: right;
  padding-top: 9px;
}
.edit-cell {
  width: 34%;
}
.cell-input {
  display: block;
  width: 100%;
  box-sizing: border-box;
  min-height: 32px;
  max-height: 160px;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: var(--mt-radius-sm);
  background: transparent;
  color: var(--mt-ink);
  font: inherit;
  line-height: 1.35;
  resize: none;
  field-sizing: content;
}
.cell-input:hover:not(:disabled) {
  border-color: var(--mt-line);
}
.cell-input:focus {
  outline: 2px solid var(--mt-accent);
  outline-offset: -1px;
  background: var(--mt-card);
}
.cell-input:disabled {
  text-decoration: line-through;
  color: var(--mt-muted);
}
.is-new {
  background: color-mix(in srgb, var(--mt-ok-ink, #2f855a) 7%, transparent);
}
.is-modified {
  background: color-mix(in srgb, var(--mt-warn-ink, #b7791f) 8%, transparent);
}
.is-removed {
  background: color-mix(in srgb, var(--mt-err-ink, #c0392b) 7%, transparent);
}
.item-row.problem {
  box-shadow: inset 3px 0 0 var(--mt-err-ink, #c0392b);
}
.last-edit {
  min-width: 170px;
  padding-top: 9px;
  font-size: 12px;
}
.badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}
.badge.new {
  color: var(--mt-ok-ink);
}
.badge.modified {
  color: var(--mt-warn-ink);
}
.badge.removed {
  color: var(--mt-err-ink);
}
.problem-text {
  color: var(--mt-err-ink, #c0392b);
  font-size: 11.5px;
}
.row-actions {
  white-space: nowrap;
  text-align: right;
  padding-top: 2px;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--mt-radius-sm);
  background: transparent;
  color: var(--mt-muted);
  cursor: pointer;
}
.icon-btn:hover {
  background: var(--mt-soft);
  color: var(--mt-ink);
}
.icon-btn.danger:hover {
  color: var(--mt-err-ink, #c0392b);
}
.publish-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  flex-shrink: 0;
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.08);
}
.publish-summary {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 13px;
}
.added {
  color: var(--mt-ok-ink);
}
.modified {
  color: var(--mt-warn-ink);
}
.removed {
  color: var(--mt-err-ink);
}
.ghost-btn {
  flex-shrink: 0;
  height: 32px;
  padding: 0 13px;
  border-radius: var(--mt-radius-lg);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  color: var(--mt-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.ghost-btn:hover:not(:disabled) {
  color: var(--mt-ink);
  border-color: var(--mt-accent);
}
.ghost-btn.small {
  height: 26px;
  padding: 0 10px;
  font-size: 11.5px;
}
.ghost-btn.danger:hover {
  color: var(--mt-err-ink, #c0392b);
  border-color: var(--mt-err-ink, #c0392b);
}
.ghost-btn:disabled,
.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.primary-btn {
  height: 36px;
  padding: 0 18px;
  border-radius: var(--mt-radius-lg);
  border: none;
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.modal-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.field-label {
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--mt-muted);
}
.text-area {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border-radius: var(--mt-radius-lg);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  font: inherit;
  font-size: 13px;
  color: var(--mt-ink);
  resize: vertical;
}
.audit {
  margin: 0;
  font-size: 12.5px;
}
</style>
