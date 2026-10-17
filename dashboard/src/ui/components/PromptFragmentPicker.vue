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
import SegmentedControl from "./SegmentedControl.vue";
import { t, tp } from "../i18n";

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
  <aside class="picker" data-testid="fragment-picker" :aria-label="t('promptFragmentPicker.fragments')">
    <div class="head">
      <div class="title"><strong>{{ t("promptFragmentPicker.fragments") }}</strong><span class="soft">{{ t("promptFragmentPicker.click_insert_to_add_one_at") }}</span></div>
      <TextInput v-model="query" type="search" :placeholder="t('promptFragmentPicker.search_fragments')" data-testid="fragment-search" />
    </div>

    <ErrorBanner v-if="error" :error="error" @retry="emit('retry')" />
    <p v-else-if="loading && fragments.length === 0" class="soft pad">{{ t("promptFragmentPicker.loading") }}</p>
    <p v-else-if="fragments.length === 0" class="soft pad" data-testid="no-fragments">{{ t("promptFragmentPicker.there_are_no_fragments_yet_create") }}</p>
    <template v-else>
      <div class="options" role="listbox" :aria-label="t('promptFragmentPicker.fragments')">
        <p v-if="visible.length === 0" class="soft pad-sm">{{ t("promptFragmentPicker.no_fragment_matches_query", { query }) }}</p>
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
            <Pill v-if="Object.keys(f.tags).length === 0" class="none">{{ t("promptFragmentPicker.no_tags_yet") }}</Pill>
          </span>
        </button>
      </div>

      <div v-if="data && choice" class="choose">
        <span class="eyebrow">{{ t("promptFragmentPicker.which_version") }}</span>
        <SegmentedControl class="seg" :aria-label="t('promptFragmentPicker.which_version2')" :options="choices.map((c, i) => ({ value: i, label: c.label, testid: `choice-${c.kind}-${c.ref}` }))" :model-value="choiceIndex" @update:model-value="choiceIndex = $event as number" />
        <p class="soft expl" data-testid="choice-explain">
          <template v-if="choice.kind === 'tag'">{{ t('promptFragmentPicker.follows_ref_today_that_is', { ref: choice.ref }) }} <b>v{{ choice.version }}</b>. {{ t('promptFragmentPicker.when_ref_moves_this_prompt_gets', { ref: choice.ref }) }} <b>{{ t('promptFragmentPicker.draft') }}</b> {{ t('promptFragmentPicker.to_review_it_never_changes_by') }}</template>
          <template v-else>{{ t("promptFragmentPicker.fixed_to") }} <b>v{{ choice.version }}</b>{{ t("promptFragmentPicker.it_stays_on_that_text_until") }}</template>
        </p>
        <p v-if="data.usedBy.length > 0" class="soft expl">{{ tp("promptFragmentPicker.usedBy", data.usedBy.length) }}</p>
      </div>
      <div v-else-if="selectedId && detailLoading" class="soft pad-sm">{{ t("promptFragmentPicker.loading") }}</div>

      <div v-if="resolved" class="preview" data-testid="fragment-preview">
        <span class="eyebrow">{{ t("promptFragmentPicker.preview_v_version", { version: resolved.version }) }}</span>
        <pre class="text"><template v-for="(part, i) in splitVariables(resolved.content)" :key="i"><span :class="{ variable: part.variable }">{{ part.text }}</span></template></pre>
        <p v-if="resolved.variables.length > 0" class="soft expl">{{ tp("promptFragmentPicker.addsVariable", resolved.variables.length) }} <code v-for="v in resolved.variables" :key="v" class="var">{{ asVariable(v) }}</code>{{ " " + t("promptFragmentPicker.to_this_prompt") }}</p>
      </div>
    </template>

    <div class="foot">
      <code v-if="snippet" class="snippet" data-testid="fragment-snippet">{{ snippet }}</code>
      <span class="grow" />
      <Button variant="primary" :disabled="!snippet" data-testid="fragment-insert" @click="emit('insert', snippet)">{{ t("promptFragmentPicker.insert") }}</Button>
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
