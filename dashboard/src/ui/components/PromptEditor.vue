<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { PromptDetailDto, PromptSummaryDto } from "@contract";
import { insertSnippet } from "@/domain/prompt-fragment";
import { renderMarkdown, splitIncludes, versionForRef } from "@/domain/prompt-render";
import { useAsync } from "../composables/useAsync";
import { usePromptApi } from "../composables/usePromptApi";
import PromptFragmentPicker from "./PromptFragmentPicker.vue";
import TextInput from "./TextInput.vue";
import SegmentedControl from "./SegmentedControl.vue";

/**
 * Editor del texto de un prompt (ADR-073): a la izquierda el texto, con la vista «Code» (editable) o «Rendered» (markdown ya
 * pintado, con cada fragmento incrustado como lo recibirá el agente), y a la derecha el panel de fragmentos, siempre visible.
 * Con `fragments` desactivado (un fragmento no incluye otros todavía) solo hay texto.
 */
const props = withDefaults(defineProps<{ modelValue: string; experimentId: string; rows?: number; fragments?: boolean; invalid?: boolean; placeholder?: string; testid?: string }>(), {
  rows: 16,
  fragments: true,
  invalid: false,
  placeholder: undefined,
  testid: "editor",
});
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const VIEW_OPTIONS = [{ value: "code", label: "Code", testid: "editor-view-code" }, { value: "rendered", label: "Rendered", testid: "editor-view-rendered" }];
const view = ref<"code" | "rendered">("code");
const hint = computed(() => (view.value === "code" ? "Markdown. Use {{variable}} for the parts that change." : "How it reads, with each fragment included."));

// ---- fragmentos de la experiencia: lista y detalle con caché ----
const api = usePromptApi();
const list = useAsync((signal) => api.listForAgent(props.experimentId, false, signal));
if (props.fragments) void list.run();
const fragmentList = computed<PromptSummaryDto[]>(() => (list.data.value ?? []).filter((p) => p.kind === "fragment"));
const details = ref<Record<string, PromptDetailDto>>({});
const pending = new Map<string, Promise<PromptDetailDto | null>>();
function loadDetail(id: string): Promise<PromptDetailDto | null> {
  const known = details.value[id];
  if (known) return Promise.resolve(known);
  let request = pending.get(id);
  if (!request) {
    request = api
      .get(id)
      .then((d) => {
        details.value = { ...details.value, [id]: d };
        return d;
      })
      .catch(() => null)
      .finally(() => pending.delete(id));
    pending.set(id, request);
  }
  return request;
}

// ---- vista renderizada: cada `{{> nombre@ref}}` se sustituye por el texto del fragmento ----
const segments = computed(() => splitIncludes(props.modelValue));
watch([segments, fragmentList, view], () => {
  if (view.value !== "rendered") return;
  for (const s of segments.value) {
    if (s.kind !== "include") continue;
    const fragment = fragmentList.value.find((f) => f.name === s.name);
    if (fragment) void loadDetail(fragment.id);
  }
}, { immediate: true });

interface RenderedBlock {
  key: number;
  html: string;
  fragment?: { label: string; missing: string | null };
}
const rendered = computed<RenderedBlock[]>(() =>
  segments.value.map((s, key): RenderedBlock => {
    if (s.kind === "text") return { key, html: renderMarkdown(s.text) };
    const label = `${s.name}@${s.ref}`;
    const summary = fragmentList.value.find((f) => f.name === s.name);
    if (!summary) return { key, html: "", fragment: { label, missing: list.loading.value ? "Loading…" : "This fragment does not exist." } };
    const detail = details.value[summary.id];
    if (!detail) return { key, html: "", fragment: { label, missing: "Loading…" } };
    const version = versionForRef(s.ref, Object.fromEntries(detail.tags.map((t) => [t.tag, t.version])));
    const found = detail.versions.find((v) => v.version === version && v.status === "published");
    if (!found) return { key, html: "", fragment: { label, missing: `${s.ref} does not point to a published version.` } };
    return { key, html: renderMarkdown(found.content), fragment: { label: `${s.name} · v${found.version}`, missing: null } };
  }),
);

// ---- insertar en el cursor ----
const box = ref<HTMLElement | null>(null);
const textarea = () => box.value?.querySelector("textarea") ?? null;
const caret = { start: -1, end: -1 };
/** el cursor se recuerda al perder el foco el texto, antes de que el clic en «Insert» lo mueva */
function rememberCaret() {
  const area = textarea();
  if (!area) return;
  caret.start = area.selectionStart;
  caret.end = area.selectionEnd;
}
async function insert(snippet: string) {
  const at = caret.start < 0 ? props.modelValue.length : caret.start;
  const next = insertSnippet(props.modelValue, at, caret.start < 0 ? at : caret.end, snippet);
  emit("update:modelValue", next.text);
  caret.start = caret.end = next.caret;
  if (view.value !== "code") return;
  await nextTick();
  const area = textarea();
  area?.focus();
  area?.setSelectionRange(next.caret, next.caret);
}
</script>

<template>
  <div class="prompt-editor" :class="{ 'with-panel': fragments }">
    <div class="main">
      <div class="bar">
        <SegmentedControl size="sm" class="view-toggle" aria-label="View" :options="VIEW_OPTIONS" :model-value="view" @update:model-value="view = $event as typeof view" />
        <span class="soft">{{ hint }}</span>
      </div>
      <div v-show="view === 'code'" ref="box" @focusout="rememberCaret" @keyup="rememberCaret" @mouseup="rememberCaret">
        <TextInput :model-value="modelValue" multiline :rows="rows" mono :invalid="invalid" :placeholder="placeholder" :data-testid="testid" @update:model-value="emit('update:modelValue', String($event))" />
      </div>
      <div v-if="view === 'rendered'" class="rendered" data-testid="editor-rendered">
        <p v-if="!modelValue.trim()" class="soft">Nothing to show yet.</p>
        <template v-for="b in rendered" :key="b.key">
          <div v-if="!b.fragment" class="md" v-html="b.html" />
          <div v-else class="embedded" :data-testid="`embedded-${b.fragment.label}`">
            <span class="tag">FRAGMENT · {{ b.fragment.label }}</span>
            <p v-if="b.fragment.missing" class="soft">{{ b.fragment.missing }}</p>
            <div v-else class="md" v-html="b.html" />
          </div>
        </template>
      </div>
    </div>
    <PromptFragmentPicker v-if="fragments" :fragments="fragmentList" :loading="list.loading.value" :error="list.error.value" :load-detail="loadDetail" @insert="insert" @retry="list.run()" />
  </div>
</template>

<style scoped>
.prompt-editor {
  display: flex;
  align-items: stretch;
  gap: 14px;
  min-width: 0;
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.main > div:not(.bar) {
  min-width: 0;
}
.bar {
  display: flex;
  align-items: center;
  gap: 12px;
}
.soft {
  color: var(--mt-muted);
  font-size: 12px;
}

.rendered {
  min-height: 320px;
  padding: 14px 18px;
  border: 1px solid var(--mt-line);
  border-radius: 8px;
  background: var(--mt-card);
  overflow: auto;
}
.md {
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.md :deep(h1),
.md :deep(h2),
.md :deep(h3),
.md :deep(h4) {
  margin: 14px 0 6px;
  line-height: 1.3;
}
.md :deep(h1) {
  font-size: 20px;
}
.md :deep(h2) {
  font-size: 17px;
}
.md :deep(h3),
.md :deep(h4) {
  font-size: 15px;
}
.md :deep(p),
.md :deep(ul),
.md :deep(ol),
.md :deep(blockquote),
.md :deep(pre) {
  margin: 0 0 10px;
}
.md :deep(ul),
.md :deep(ol) {
  padding-left: 22px;
}
.md :deep(blockquote) {
  padding-left: 12px;
  border-left: 3px solid var(--mt-line);
  color: var(--mt-muted);
}
.md :deep(code) {
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--mt-soft);
  font-family: var(--mt-mono);
  font-size: 12.5px;
}
.md :deep(pre) {
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--mt-soft);
  overflow: auto;
}
.md :deep(pre code) {
  padding: 0;
  background: none;
}
.md :deep(.variable) {
  padding: 0 3px;
  border-radius: 3px;
  background: var(--mt-highlight-soft);
  color: var(--mt-highlight-ink);
  font-family: var(--mt-mono);
  font-size: 12.5px;
}
.embedded {
  margin: 6px 0 12px;
  padding: 10px 14px 4px;
  border-left: 3px solid var(--mt-brand);
  border-radius: 0 8px 8px 0;
  background: var(--mt-accent-tint);
}
.tag {
  display: block;
  margin-bottom: 6px;
  font-family: var(--mt-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--mt-accent-text);
}
.embedded .soft {
  margin: 0 0 8px;
}
@media (max-width: 900px) {
  .prompt-editor {
    flex-direction: column;
  }
}
</style>
