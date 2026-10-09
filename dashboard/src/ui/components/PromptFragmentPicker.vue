<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { PromptDetailDto, PromptSummaryDto } from "@contract";
import { fragmentRefChoices, includeSyntax } from "@/domain/prompt-fragment";
import { sortEnvironments, splitVariables } from "@/domain/prompt-release";
import EnvFlag from "./EnvFlag.vue";
import ErrorBanner from "./ErrorBanner.vue";
import TextInput from "./TextInput.vue";
import Button from "./Button.vue";
import Pill from "./Pill.vue";

/**
 * Panel de fragmentos que acompaña al editor del prompt (ADR-073), siempre visible: enseña a qué versión resuelve cada
 * forma de referirlo, el texto que aportaría y las variables que añade. Solo emite la sintaxis; guardar la versión la fija.
 */
const props = defineProps<{
  fragments: PromptSummaryDto[];
  loading: boolean;
  error: Error | null;
  loadDetail: (id: string) => Promise<PromptDetailDto | null>;
}>();
const emit = defineEmits<{ insert: [snippet: string]; retry: [] }>();

const query = ref("");
const visible = computed(() => {
  const q = query.value.trim().toLowerCase();
  return props.fragments.filter((f) => !q || f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q));
});

const selectedId = ref<string | null>(null);
watch(() => props.fragments, (all) => {
  if (selectedId.value === null && all.length > 0) selectedId.value = all[0]!.id;
}, { immediate: true });

const loaded = ref<PromptDetailDto | null>(null);
const detailLoading = ref(false);
watch(selectedId, async (id) => {
  if (!id) return;
  detailLoading.value = true;
  const result = await props.loadDetail(id);
  if (selectedId.value === id) loaded.value = result;
  detailLoading.value = false;
}, { immediate: true });
const data = computed(() => (loaded.value?.prompt.id === selectedId.value ? loaded.value : null));

const published = computed(() => (data.value?.versions ?? []).filter((v) => v.status === "published"));
const choices = computed(() => {
  if (!data.value) return [];
  const tags = Object.fromEntries(data.value.tags.map((t) => [t.tag, t.version]));
  return fragmentRefChoices(tags, published.value[0]?.version ?? 0);
});
const choiceIndex = ref(0);
watch(choices, () => {
  choiceIndex.value = 0;
});
const choice = computed(() => choices.value[choiceIndex.value] ?? null);
const resolved = computed(() => (choice.value ? (published.value.find((v) => v.version === choice.value!.version) ?? null) : null));
const snippet = computed(() => (data.value && choice.value ? includeSyntax(data.value.prompt.name, choice.value.ref) : ""));
const asVariable = (name: string) => `{{${name}}}`;
const tagsOf = (f: PromptSummaryDto) => sortEnvironments(Object.keys(f.tags)).map((t): [string, number] => [t, f.tags[t]!]);
</script>

<template>
  <aside class="picker" data-testid="fragment-picker" aria-label="Fragments">
    <div class="head">
      <div class="title"><strong>Fragments</strong><span class="soft">click Insert to add one at the cursor</span></div>
      <TextInput v-model="query" type="search" placeholder="Search fragments…" data-testid="fragment-search" />
    </div>

    <ErrorBanner v-if="error" :error="error" @retry="emit('retry')" />
    <p v-else-if="loading && fragments.length === 0" class="soft pad">Loading…</p>
    <p v-else-if="fragments.length === 0" class="soft pad" data-testid="no-fragments">There are no fragments yet. Create one from the Prompts list with “New fragment”.</p>
    <template v-else>
      <div class="options" role="listbox" aria-label="Fragments">
        <p v-if="visible.length === 0" class="soft pad-sm">No fragment matches “{{ query }}”.</p>
        <button
          v-for="f in visible"
          :key="f.id"
          type="button"
          class="option"
          :class="{ on: f.id === selectedId }"
          role="option"
          :aria-selected="f.id === selectedId"
          :data-testid="`fragment-option-${f.name}`"
          @click="selectedId = f.id"
        >
          <strong>{{ f.name }}</strong>
          <span v-if="f.description" class="soft clamp">{{ f.description }}</span>
          <span class="tags">
            <template v-for="[tag, version] in tagsOf(f)" :key="tag"><EnvFlag :env="tag" /><span class="soft mono">→ v{{ version }}</span></template>
            <Pill v-if="Object.keys(f.tags).length === 0" class="none">no tags yet</Pill>
          </span>
        </button>
      </div>

      <div v-if="data && choice" class="choose">
        <span class="eyebrow">WHICH VERSION</span>
        <div class="seg" role="group" aria-label="Which version">
          <button v-for="(c, i) in choices" :key="c.ref" type="button" :class="{ on: i === choiceIndex }" :data-testid="`choice-${c.kind}-${c.ref}`" @click="choiceIndex = i">{{ c.label }}</button>
        </div>
        <p class="soft expl" data-testid="choice-explain">
          <template v-if="choice.kind === 'tag'">Follows {{ choice.ref }}: today that is <b>v{{ choice.version }}</b>. When {{ choice.ref }} moves, this prompt gets a <b>draft</b> to review. It never changes by itself.</template>
          <template v-else>Fixed to <b>v{{ choice.version }}</b>. It stays on that text until someone edits this prompt.</template>
        </p>
        <p v-if="data.usedBy.length > 0" class="soft expl">Used by {{ data.usedBy.length }} {{ data.usedBy.length === 1 ? "prompt" : "prompts" }}.</p>
      </div>
      <div v-else-if="selectedId && detailLoading" class="soft pad-sm">Loading…</div>

      <div v-if="resolved" class="preview" data-testid="fragment-preview">
        <span class="eyebrow">PREVIEW · v{{ resolved.version }}</span>
        <pre class="text"><template v-for="(part, i) in splitVariables(resolved.content)" :key="i"><span :class="{ variable: part.variable }">{{ part.text }}</span></template></pre>
        <p v-if="resolved.variables.length > 0" class="soft expl">Adds {{ resolved.variables.length === 1 ? "the variable" : "the variables" }} <code v-for="v in resolved.variables" :key="v" class="var">{{ asVariable(v) }}</code> to this prompt.</p>
      </div>
    </template>

    <div class="foot">
      <code v-if="snippet" class="snippet" data-testid="fragment-snippet">{{ snippet }}</code>
      <span class="grow" />
      <Button variant="primary" :disabled="!snippet" data-testid="fragment-insert" @click="emit('insert', snippet)">Insert</Button>
    </div>
  </aside>
</template>

<style scoped>
.picker {
  width: 340px;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 0 0;
  background: var(--mt-card);
  border: 1px solid var(--mt-line);
  border-radius: 10px;
  overflow: hidden;
  align-self: stretch;
  max-height: 100%;
  overflow-y: auto;
}
.head,
.choose,
.preview {
  padding: 0 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.title {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.soft {
  color: var(--mt-muted);
  font-size: 12px;
}
.pad,
.pad-sm {
  margin: 0;
  padding: 0 16px 14px;
}
.options {
  padding: 0 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 200px;
  overflow: auto;
}
.option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 10px 12px;
  border: 1.5px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.option:hover {
  background: var(--mt-soft);
}
.option.on {
  border-color: var(--mt-brand);
  background: var(--mt-accent-tint);
}
.clamp {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.tags {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.mt-pill.none {
  background: var(--mt-soft);
  color: var(--mt-muted);
}
.eyebrow {
  font-family: var(--mt-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--mt-faint);
}
.seg {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.seg button {
  flex: 1;
  min-width: 120px;
  height: 34px;
  border: 1px solid var(--mt-line);
  border-radius: 6px;
  background: var(--mt-card);
  color: var(--mt-muted);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.seg button.on {
  border: 1.5px solid var(--mt-brand);
  background: var(--mt-accent-tint);
  color: var(--mt-accent-text);
  font-weight: 800;
}
.expl {
  margin: 0;
  line-height: 1.5;
}
.expl b {
  color: var(--mt-ink);
}
.preview {
  margin: 0 16px;
  padding: 12px;
  border-radius: 8px;
  background: var(--mt-soft);
}
.text {
  margin: 0;
  max-height: 140px;
  overflow: auto;
  font-family: var(--mt-mono);
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--mt-muted);
  white-space: pre-wrap;
}
.variable,
.var {
  background: var(--mt-highlight-soft);
  color: var(--mt-highlight-ink);
  border-radius: 3px;
  padding: 0 3px;
  font-family: var(--mt-mono);
  font-weight: 500;
}
.foot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--mt-line);
}
.grow {
  flex: 1;
}
.snippet {
  padding: 4px 8px;
  border: 1px solid var(--mt-line);
  border-radius: 4px;
  background: var(--mt-card);
  font-size: 12px;
  overflow-wrap: anywhere;
}

</style>
