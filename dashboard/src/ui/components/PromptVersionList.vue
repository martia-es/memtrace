<script setup lang="ts">
/**
 * Lista de versiones de un prompt: buscador, las fijadas por tag arriba y el resto agrupado por mes. La usan el desplegable del texto
 * y la pestaña Versions, así que la selección vive en la página y aquí solo se emite `pick`.
 */
import { computed, ref } from "vue";
import type { PromptVersionDto } from "@contract";
import { formatDateTime } from "@/domain/format";
import { filterVersions, groupByMonth } from "@/domain/prompt-release";
import EnvFlag from "./EnvFlag.vue";
import Pill from "./Pill.vue";
import TextInput from "./TextInput.vue";

const props = defineProps<{
  versions: PromptVersionDto[];
  selected: number | null;
  /** tags por versión, ya ordenados por entorno */
  tagsByVersion: Map<number, string[]>;
  pinned: { tag: string; version: number; message: string }[];
  /** entornos donde corre una versión */
  running: (version: number) => string[];
  authorName: (userId: string | null) => string | null;
}>();
defineEmits<{ pick: [version: number] }>();

const query = ref("");
const visible = computed(() => filterVersions(props.versions, query.value));
const groups = computed(() => groupByMonth(visible.value));
</script>

<template>
  <div class="version-list-root">
    <div class="rail-head">
      <div class="rail-title"><strong>Versions</strong><span class="mono soft">{{ versions.length }} in total</span></div>
      <TextInput v-model="query" type="search" placeholder="v number or message…" data-testid="version-search" />
    </div>

    <div v-if="pinned.length > 0 && !query" class="pinned" data-testid="pinned">
      <span class="eyebrow">PINNED BY TAGS</span>
      <button
        v-for="p in pinned"
        :key="p.tag"
        type="button"
        class="version compact"
        :class="{ active: p.version === selected }"
        :data-testid="`pinned-${p.tag}`"
        @click="$emit('pick', p.version)"
      >
        <EnvFlag :env="p.tag" />
        <strong class="mono">v{{ p.version }}</strong>
        <span v-if="p.message" class="version-msg">{{ p.message }}</span>
      </button>
    </div>

    <div class="all" data-testid="version-list">
      <p v-if="visible.length === 0" class="soft empty-list" data-testid="no-versions">No version matches “{{ query }}”.</p>
      <template v-for="group in groups" :key="group.key">
        <span class="eyebrow group-label">{{ group.label.toUpperCase() }}</span>
        <button
          v-for="v in group.items"
          :key="v.version"
          type="button"
          class="version"
          :class="{ active: v.version === selected }"
          :data-testid="`version-${v.version}`"
          @click="$emit('pick', v.version)"
        >
          <span class="version-head">
            <strong class="mono">v{{ v.version }}</strong>
            <Pill v-if="v.status === 'draft'" :data-testid="`draft-${v.version}`" class="draft-pill">draft</Pill>
            <EnvFlag v-for="tag in tagsByVersion.get(v.version) ?? []" :key="tag" :env="tag" />
            <span class="grow" />
            <span class="mono version-date">{{ formatDateTime(v.createdAt) }}</span>
          </span>
          <span v-if="v.message" class="version-msg">{{ v.message }}</span>
          <span v-if="authorName(v.createdBy)" class="version-author" :data-testid="`author-${v.version}`">by {{ authorName(v.createdBy) }}</span>
          <span v-if="running(v.version).length > 0" class="running" :data-testid="`running-${v.version}`">Running in {{ running(v.version).join(", ") }}</span>
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.version-list-root {
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.soft {
  color: var(--mt-muted);
  font-size: 12px;
  margin: 0;
}
.grow {
  flex: 1;
}
.eyebrow {
  font-family: var(--mt-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  color: var(--mt-faint);
}
.rail-head {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 12px 8px;
}
.rail-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 14px;
}
.pinned {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 12px 8px;
  border-bottom: 1px solid var(--mt-line);
}
.all {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 12px 12px;
}
.group-label {
  display: block;
  padding: 8px 0 4px;
}
.empty-list {
  padding: 12px 0;
}
.version {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: 1.5px solid transparent;
  border-radius: var(--mt-radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.version.compact {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
}
.version:hover {
  background: var(--mt-soft-2);
}
.version:focus-visible {
  outline: 2px solid var(--mt-accent);
  outline-offset: 1px;
}
.version.active,
.version.active:hover {
  background: var(--mt-accent-tint);
  box-shadow: inset 0 0 0 1.5px var(--mt-brand);
  color: var(--mt-ink);
}
.version-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.version-msg {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
}
.version-author {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  color: var(--mt-text-soft, inherit);
  opacity: 0.75;
}
.version-date {
  font-size: 10.5px;
  color: var(--mt-faint);
}
.version.active .version-date {
  color: var(--mt-muted);
}
.running {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--mt-ok-ink);
}
.draft-pill {
  background: var(--mt-warn-bg);
  color: var(--mt-warn-ink);
}
</style>
