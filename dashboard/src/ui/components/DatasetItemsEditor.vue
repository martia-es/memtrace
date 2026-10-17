<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import type { DatasetItemDto } from "@contract";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { useQuasar } from "quasar";
import { formatDateTime } from "@/domain/format";
import { conversationPreview, type ConversationPreview } from "@/domain/conversation-preview";
import { blankRow, buildCommit, isDirty, nextVersionLabel, pasteGrid, parseClipboardGrid, rowProblem, rowState, rowsFromItems, summarize, type DraftRow } from "../dataset-draft";
import Modal from "./Modal.vue";
import { useTraceApi } from "../composables/useTraceApi";
import Button from "./Button.vue";
import Checkbox from "./Checkbox.vue";
import MessageBlock from "./MessageBlock.vue";
import TabBar from "./TabBar.vue";
import Card from "./Card.vue";
import Pill from "./Pill.vue";
import { t, tp } from "../i18n";

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
const detailTab = ref<"messages" | "json" | "metadata">("metadata");
// celda con el foco (como la celda seleccionada de una hoja): alimenta la caja de nombre, la barra de fórmulas y el resaltado de cabeceras
const active = ref<{ key: string; col: 0 | 1 } | null>(null);
const COLUMN_LETTERS = ["A", "B", "C"] as const;
const publishing = ref(false);

const summary = computed(() => summarize(rows.value));
const dirty = computed(() => isDirty(rows.value));
const changeCount = computed(() => summary.value.added + summary.value.edited + summary.value.removed);
const nextLabel = computed(() => nextVersionLabel(props.version ?? { major: 1, minor: 0 }, summary.value));
const detailRow = computed(() => rows.value.find((r) => r.key === detailKey.value) ?? null);
const activeRow = computed(() => rows.value.find((r) => r.key === active.value?.key) ?? null);
const activeLabel = computed(() => {
  const row = activeRow.value;
  if (!row || !active.value) return "";
  const at = visibleRows.value.indexOf(row);
  return at < 0 ? "" : `${COLUMN_LETTERS[active.value.col]}${at + 1}`;
});
// una celda con conversación se ve como texto y se edita en el detalle: el JSON guardado no se reescribe desde la vista
const previewOf = (row: DraftRow, col: 0 | 1): ConversationPreview | null => conversationPreview(col === 0 ? row.input : row.expected, col === 0 ? "input" : "expected");
const activePreview = computed(() => (!activeRow.value || !active.value ? null : previewOf(activeRow.value, active.value.col)));
const activeText = computed(() => {
  if (!activeRow.value || !active.value) return "";
  if (activePreview.value) return activePreview.value.summary;
  return active.value.col === 0 ? activeRow.value.input : activeRow.value.expected;
});
const detailPreviews = computed(() => (detailRow.value ? { input: previewOf(detailRow.value, 0), expected: previewOf(detailRow.value, 1) } : null));
const detailTabs = computed(() => {
  const hasChat = !!(detailPreviews.value?.input || detailPreviews.value?.expected);
  return [...(hasChat ? [{ id: "messages", label: t("datasetItemsEditor.messages") }, { id: "json", label: t("datasetItemsEditor.json_as_saved") }] : []), { id: "metadata", label: t("datasetItemsEditor.metadata") }];
});
const chatCount = computed(() => rows.value.filter((r) => !r.removed && rowState(r) !== "empty" && (previewOf(r, 0) || previewOf(r, 1))).length);

function openDetails(row: DraftRow, tab?: "messages" | "json" | "metadata") {
  detailKey.value = row.key;
  detailTab.value = tab ?? (previewOf(row, 0) || previewOf(row, 1) ? "messages" : "metadata");
}
const itemCount = computed(() => rows.value.filter((r) => rowState(r) !== "empty" && !r.removed).length);

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
  $q.notify({ message: tp("datasetItemsEditor.pasted", grid.length), timeout: 1500 });
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
    $q.notify({ message: t("datasetItemsEditor.fix_the_highlighted_rows_before_publishi"), color: "negative", timeout: 3000 });
    return;
  }
  publishing.value = true;
  const label = nextLabel.value;
  try {
    const response = await api.commitDatasetChanges(props.datasetId, buildCommit(rows.value));
    rows.value = rowsFromItems(response.items);
    selected.value = new Set();
    $q.notify({ message: t("datasetItemsEditor.published_label", { label }), color: "positive", timeout: 2500 });
    emit("published");
  } catch (error) {
    const detail = error instanceof Error ? error.message : t("datasetItemsEditor.unknown_error");
    $q.notify({ message: t("datasetItemsEditor.could_not_publish_detail", { detail }), color: "negative", timeout: 5000 });
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
onBeforeRouteLeave(() => !dirty.value || window.confirm(t("datasetItemsEditor.you_have_unpublished_changes_leave_and")));

defineExpose({ dirty });
</script>

<template>
  <div ref="root" class="editor">
    <div class="toolbar">
      <TextInput type="search" v-model="search" :placeholder="t('datasetItemsEditor.search_items')" class="search" />
      <template v-if="selected.size > 0">
        <span class="muted">{{ t('datasetItemsEditor.count_selected', { count: selected.size }) }}</span>
        <Button size="sm" @click="duplicateSelected">{{ t("datasetItemsEditor.duplicate") }}</Button>
        <Button variant="danger" size="sm" @click="removeSelected">{{ t("datasetItemsEditor.delete") }}</Button>
      </template>
      <span class="spacer" />
      <span class="muted hint">{{ t("datasetItemsEditor.enter_next_row_shift_enter_new") }}</span>
    </div>

    <div class="formula-bar" data-testid="formula-bar">
      <span class="name-box mono" :aria-label="t('datasetItemsEditor.selected_cell')">{{ activeLabel || "–" }}</span>
      <span class="fx" aria-hidden="true">fx</span>
      <output class="formula" :aria-label="t('datasetItemsEditor.content_of_the_selected_cell')">
        <Pill v-if="activePreview" tone="accent" class="chat-chip">{{ t("datasetItemsEditor.chat_count", { count: activePreview.count }) }}</Pill>
        {{ activeText }}
      </output>
      <Button v-if="activeRow && activePreview" size="sm" class="formula-action" @click="openDetails(activeRow)">{{ t("datasetItemsEditor.edit_in_details") }}</Button>
    </div>

    <Card padding="none" block class="table-card">
      <table class="items">
        <colgroup>
          <col class="col-check" />
          <col class="col-idx" />
          <col class="col-text" />
          <col class="col-text" />
          <col class="col-meta" />
          <col class="col-actions" />
        </colgroup>
        <thead>
          <tr>
            <th class="check"><Checkbox :aria-label="t('datasetItemsEditor.select_all')" :checked="allSelected" @change="toggleAll" /></th>
            <th class="idx">#</th>
            <th :class="{ 'col-on': active?.col === 0 }"><span class="letter mono">A</span>{{ t("datasetItemsEditor.input") }}</th>
            <th :class="{ 'col-on': active?.col === 1 }"><span class="letter mono">B</span>{{ t("datasetItemsEditor.expected_output") }}</th>
            <th><span class="letter mono">C</span>{{ t("datasetItemsEditor.last_edit") }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in visibleRows" :key="row.key" class="item-row" :class="[`is-${rowState(row)}`, { problem: rowProblem(row) }]">
            <td class="check">
              <Checkbox v-if="rowState(row) !== 'empty' && !row.removed" :checked="selected.has(row.key)" :aria-label="t('datasetItemsEditor.select_row_n', { n: i + 1 })" @change="toggle(row)" />
            </td>
            <td class="idx mono muted" :class="{ 'row-on': active?.key === row.key }">{{ rowState(row) === "empty" ? "+" : i + 1 }}</td>
            <td v-for="col in [0, 1] as const" :key="col" class="edit-cell">
              <div v-if="previewOf(row, col)" class="chat-cell">
                <Pill tone="accent" class="chat-chip">{{ t("datasetItemsEditor.chat_count", { count: previewOf(row, col)!.count }) }}</Pill>
                <textarea
                  :data-cell="`${row.key}:${col}`"
                  class="cell-input"
                  rows="1"
                  readonly
                  :value="previewOf(row, col)!.summary"
                  :aria-label="t('datasetItemsEditor.field_of_row_n_a_conversation', { field: col === 0 ? t('datasetItemsEditor.input') : t('datasetItemsEditor.expected_output'), n: i + 1, count: previewOf(row, col)!.count })"
                  @focus="active = { key: row.key, col }"
                  @click="openDetails(row, 'messages')"
                  @keydown="onKeydown($event, row, col)"
                ></textarea>
              </div>
              <textarea
                v-else
                :data-cell="`${row.key}:${col}`"
                class="cell-input"
                rows="1"
                :disabled="row.removed"
                :value="col === 0 ? row.input : row.expected"
                :placeholder="rowState(row) === 'empty' ? (col === 0 ? t('datasetItemsEditor.type_here_to_add_an_item') : '') : col === 0 ? t('datasetItemsEditor.required') : t('datasetItemsEditor.optional')"
                :aria-label="t('datasetItemsEditor.field_of_row_n', { field: col === 0 ? t('datasetItemsEditor.input') : t('datasetItemsEditor.expected_output'), n: i + 1 })"
                @input="(e) => { const v = (e.target as HTMLTextAreaElement).value; if (col === 0) row.input = v; else row.expected = v; ensureTrailingBlank(); }"
                @focus="active = { key: row.key, col }"
                @keydown="onKeydown($event, row, col)"
                @paste="onPaste($event, row, col)"
              ></textarea>
            </td>
            <td class="muted last-edit">
              <div class="meta-line">
                <Pill v-if="row.id === null && rowState(row) !== 'empty'" tone="ok">{{ t("datasetItemsEditor.new") }}</Pill>
                <Pill v-else-if="rowState(row) === 'modified'" tone="warn">{{ t("datasetItemsEditor.edited") }}</Pill>
                <Pill v-else-if="row.removed" tone="error">{{ t("datasetItemsEditor.will_be_deleted") }}</Pill>
                <span v-else>{{ lastEdit(row) }}</span>
              </div>
              <div v-if="rowProblem(row)" class="problem-text">{{ rowProblem(row) }}</div>
            </td>
            <td class="row-actions">
              <template v-if="rowState(row) !== 'empty'">
                <Button size="sm" v-if="row.removed" @click="restore(row)">{{ t("datasetItemsEditor.restore") }}</Button>
                <template v-else>
                  <Button variant="icon" v-if="rowState(row) === 'modified'" :title="t('datasetItemsEditor.undo_changes_to_this_row')" :aria-label="t('datasetItemsEditor.undo_changes_to_this_row')" @click="revert(row)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6M3.5 13a9 9 0 1 0 2.6-6.4L3 9" /></svg>
                  </Button>
                  <Button variant="icon" :title="t('datasetItemsEditor.details_metadata_audit')" :aria-label="t('datasetItemsEditor.details')" @click="openDetails(row)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
                  </Button>
                  <Button variant="icon" :title="t('datasetItemsEditor.duplicate')" :aria-label="t('datasetItemsEditor.duplicate')" @click="duplicate(row)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></svg>
                  </Button>
                  <Button variant="icon" :title="t('datasetItemsEditor.delete')" :aria-label="t('datasetItemsEditor.delete')" @click="remove(row)" class="danger">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" /></svg>
                  </Button>
                </template>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </Card>

    <div class="status-bar muted" data-testid="status-bar">
      <span>{{ tp("datasetItemsEditor.items", itemCount) }}</span>
      <span v-if="activeLabel">{{ t('datasetItemsEditor.selection_label', { label: activeLabel }) }}</span>
      <span v-if="chatCount">{{ tp("datasetItemsEditor.chats", chatCount) }}</span>
      <span class="spacer" />
      <span v-if="dirty" class="modified">{{ tp("datasetItemsEditor.changesSince", changeCount, { version: `${version?.major ?? 1}.${version?.minor ?? 0}` }) }}</span>
      <span v-else>{{ t("datasetItemsEditor.no_changes_since_v_version", { version: `${version?.major ?? 1}.${version?.minor ?? 0}` }) }}</span>
    </div>

    <!-- barra de publicación: aparece solo con cambios sin publicar -->
    <Card padding="none" block v-if="dirty" class="publish-bar" role="status">
      <div class="publish-summary">
        <strong>{{ tp("datasetItemsEditor.unpublished", changeCount) }}</strong>
        <span v-if="summary.added" class="added">{{ t('datasetItemsEditor.count_added', { count: summary.added }) }}</span>
        <span v-if="summary.edited" class="modified">{{ t('datasetItemsEditor.count_edited', { count: summary.edited }) }}</span>
        <span v-if="summary.removed" class="removed">{{ t('datasetItemsEditor.count_deleted', { count: summary.removed }) }}</span>
        <span class="muted">{{ t("datasetItemsEditor.will_be_saved_as_one_version") + " " }}<b>{{ nextLabel }}</b></span>
      </div>
      <Button :disabled="publishing" @click="discard">{{ t("datasetItemsEditor.discard") }}</Button>
      <Button variant="primary" :disabled="publishing || summary.problems > 0" @click="publish">{{ publishing ? "Publishing…" : `Publish ${nextLabel}` }}</Button>
    </Card>

    <Modal v-if="detailRow" :title="t('datasetItemsEditor.item_details')" :wide="detailTabs.length > 1" @close="detailKey = null">
      <div class="modal-form">
        <TabBar v-if="detailTabs.length > 1" v-model="detailTab" :tabs="detailTabs" />
        <template v-if="detailTab === 'messages' && detailPreviews">
          <template v-for="side in ([['input', 'Input'], ['expected', 'Expected output']] as const)" :key="side[0]">
            <template v-if="detailPreviews[side[0]]">
              <label class="field-label">{{ side[1] }} · {{ tp("datasetItemsEditor.messages", detailPreviews[side[0]]!.count) }}</label>
              <MessageBlock v-for="(block, n) in detailPreviews[side[0]]!.blocks" :key="n" :block="block" />
            </template>
          </template>
          <p class="muted audit">{{ t("datasetItemsEditor.the_dataset_stores_the_messages_exactly") }}</p>
        </template>
        <template v-else-if="detailTab === 'json'">
          <label class="field-label" for="item-input-json">{{ t("datasetItemsEditor.input") }}</label>
          <TextInput id="item-input-json" v-model="detailRow.input" multiline mono :rows="6" />
          <label class="field-label" for="item-expected-json">{{ t("datasetItemsEditor.expected_output") }}</label>
          <TextInput id="item-expected-json" v-model="detailRow.expected" multiline mono :rows="6" />
          <div v-if="rowProblem(detailRow)" class="problem-text">{{ rowProblem(detailRow) }}</div>
        </template>
        <template v-else>
          <label class="field-label" for="item-metadata">{{ t("datasetItemsEditor.metadata_json_object_optional") }}</label>
          <TextInput id="item-metadata" v-model="detailRow.metadata" multiline mono :rows="5" placeholder='{"source": "manual"}' />
          <div v-if="rowProblem(detailRow)" class="problem-text">{{ rowProblem(detailRow) }}</div>
          <template v-if="detailRow.id && itemsById.get(detailRow.id)">
            <label class="field-label">{{ t("datasetItemsEditor.audit") }}</label>
            <p class="muted audit">
              Added by {{ itemsById.get(detailRow.id)!.createdByEmail }} · {{ formatDateTime(itemsById.get(detailRow.id)!.createdAt) }}<br />
              <template v-if="itemsById.get(detailRow.id)!.updatedByEmail">{{ t('datasetItemsEditor.last_edited_by_email_when', { email: itemsById.get(detailRow.id)!.updatedByEmail, when: formatDateTime(itemsById.get(detailRow.id)!.updatedAt!) }) }}</template>
              <template v-else>{{ t("datasetItemsEditor.never_edited") }}</template>
            </p>
          </template>
        </template>
        <Button variant="primary" @click="detailKey = null">{{ t("datasetItemsEditor.done") }}</Button>
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
  table-layout: fixed;
  font-size: 13px;
}
.col-check {
  width: 36px;
}
.col-idx {
  width: 48px;
}
.col-text {
  width: 36%;
}
.col-meta {
  width: 190px;
}
.col-actions {
  width: 150px;
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
  border-right: 1px solid var(--mt-line-2);
  vertical-align: top;
}
th {
  border-right: 1px solid var(--mt-line-2);
}
.letter {
  margin-right: 8px;
  color: var(--mt-faint, var(--mt-muted));
  font-weight: 500;
}
th.col-on {
  background: var(--mt-soft);
  color: var(--mt-ink);
  box-shadow: inset 0 -2px 0 var(--mt-accent);
}
.idx.row-on {
  background: var(--mt-soft);
  color: var(--mt-ink);
}
.formula-bar {
  display: flex;
  align-items: stretch;
  min-height: 32px;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-sm);
  background: var(--mt-card);
  overflow: hidden;
  font-size: 13px;
}
.name-box {
  width: 64px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-right: 1px solid var(--mt-line);
  background: var(--mt-soft-2);
  font-size: 12px;
}
.fx {
  width: 34px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-right: 1px solid var(--mt-line);
  color: var(--mt-muted);
  font-family: serif;
  font-style: italic;
}
.formula {
  flex: 1;
  min-width: 0;
  padding: 6px 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 96px;
  overflow: auto;
}
.status-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-shrink: 0;
  font-size: 12px;
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
  vertical-align: top;
  white-space: normal;
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
.chat-cell {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
}
.chat-cell .chat-chip {
  flex: none;
  margin-top: 6px;
  font-family: var(--mt-mono);
  font-size: 10.5px;
}
.chat-cell .cell-input {
  flex: 1;
  min-width: 0;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
}
.formula-action {
  flex: none;
  align-self: center;
  margin: 0 8px;
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
  padding-top: 9px;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.meta-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
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
