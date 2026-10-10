<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { AssistantPersonDto } from "@contract";
import { personLabel } from "@/domain/assistants";
import { useAssistantApi } from "../../composables/useAssistantApi";
import PersonAvatar from "./PersonAvatar.vue";
import Button from "../Button.vue";

/** Selector de una persona de la organización: se busca por nombre o email y cada opción lleva su foto. */
const props = defineProps<{ experimentId: string; modelValue: AssistantPersonDto | null }>();
const emit = defineEmits<{ "update:modelValue": [person: AssistantPersonDto | null] }>();

const api = useAssistantApi();
const query = ref("");
const open = ref(false);
const loading = ref(false);
const failed = ref(false);
const results = ref<AssistantPersonDto[]>([]);
const active = ref(0);
let timer: ReturnType<typeof setTimeout> | undefined;
let controller: AbortController | null = null;

async function search() {
  controller?.abort();
  const current = (controller = new AbortController());
  loading.value = true;
  failed.value = false;
  try {
    const found = await api.searchPeople(props.experimentId, query.value.trim(), current.signal);
    if (controller !== current) return;
    results.value = found;
    active.value = 0;
  } catch {
    if (!current.signal.aborted) failed.value = true;
  } finally {
    if (controller === current) loading.value = false;
  }
}

watch(query, () => {
  open.value = true;
  clearTimeout(timer);
  timer = setTimeout(() => void search(), 200);
});
onBeforeUnmount(() => {
  clearTimeout(timer);
  controller?.abort();
});

function show() {
  open.value = true;
  if (results.value.length === 0 && !loading.value) void search();
}

function choose(person: AssistantPersonDto) {
  emit("update:modelValue", person);
  open.value = false;
  query.value = "";
}

function clear() {
  emit("update:modelValue", null);
  show();
}

function onKey(event: KeyboardEvent) {
  if (event.key === "ArrowDown") { event.preventDefault(); active.value = Math.min(active.value + 1, results.value.length - 1); }
  else if (event.key === "ArrowUp") { event.preventDefault(); active.value = Math.max(active.value - 1, 0); }
  else if (event.key === "Enter" && open.value && results.value[active.value]) { event.preventDefault(); choose(results.value[active.value]!); }
  else if (event.key === "Escape") open.value = false;
}

const empty = computed(() => !loading.value && !failed.value && results.value.length === 0);
</script>

<template>
  <div class="picker" data-testid="person-picker">
    <div v-if="modelValue" class="chosen">
      <PersonAvatar :name="modelValue.name" :email="modelValue.email" :image="modelValue.image" :size="28" />
      <span class="who"><strong>{{ personLabel(modelValue) }}</strong><small v-if="modelValue.name">{{ modelValue.email }}</small></span>
      <Button variant="link" @click="clear">Change</Button>
    </div>
    <template v-else>
      <TextInput
        v-model="query"
        placeholder="Search by name or email"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="open"
        autocomplete="off"
        autofocus
        @focus="show"
        @keydown="onKey"
        @blur="open = false" />
      <ul v-if="open" class="options" role="listbox">
        <li v-for="(p, i) in results" :key="p.userId" role="option" :aria-selected="i === active" :class="{ active: i === active }" @mousedown.prevent="choose(p)" @mousemove="active = i">
          <PersonAvatar :name="p.name" :email="p.email" :image="p.image" :size="28" />
          <span class="who"><strong>{{ personLabel(p) }}</strong><small v-if="p.name">{{ p.email }}</small></span>
        </li>
        <li v-if="loading" class="note">Searching…</li>
        <li v-else-if="failed" class="note">Could not search people.</li>
        <li v-else-if="empty" class="note">No one matches.</li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.picker { position: relative; }
.chosen, .options li { display: flex; align-items: center; gap: 10px; }
.chosen { padding: 4px 8px; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); background: var(--mt-card); }
.who { display: flex; flex-direction: column; min-width: 0; flex: 1; font-size: 13px; line-height: 1.25; }
.who small { color: var(--mt-muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
.link { background: none; border: 0; padding: 0; font: inherit; font-size: 12px; font-weight: 700; color: var(--mt-accent-text); cursor: pointer; }
/* en el flujo, no flotando: el modal crece con la lista en vez de recortarla */
.options {
  margin: 6px 0 0; padding: 4px; list-style: none;
  min-height: 132px; max-height: 280px; overflow-y: auto;
  background: var(--mt-card); border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm);
}
.options li { padding: 6px 8px; border-radius: var(--mt-radius-sm); cursor: pointer; }
.options li.active { background: var(--mt-accent-soft); }
.options li.note { cursor: default; color: var(--mt-muted); font-size: 12px; }
</style>
