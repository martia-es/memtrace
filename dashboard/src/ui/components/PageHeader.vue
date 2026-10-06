<script setup lang="ts">
import { computed } from "vue";
import TopbarSlot from "./TopbarSlot.vue";

const props = defineProps<{
  crumbs: { label: string; to?: { name: string; params?: Record<string, string> } }[];
  title: string;
  /** en desuso: el topbar ya no pinta icono; se acepta para no romper llamadas existentes */
  icon?: string;
}>();

// la raíz "MemTrace" es el logo del sidebar: no se repite. El último nivel es `title`.
const ancestors = computed(() => props.crumbs.slice(0, -1).filter((c) => c.label !== "MemTrace"));
</script>

<template>
  <TopbarSlot side="left">
    <nav class="crumbs" aria-label="Breadcrumb">
      <template v-for="(c, i) in ancestors" :key="i">
        <router-link v-if="c.to" :to="c.to" class="crumb link">{{ c.label }}</router-link>
        <span v-else class="crumb">{{ c.label }}</span>
        <span class="sep">/</span>
      </template>
      <h1>{{ title }}</h1>
    </nav>
  </TopbarSlot>
  <TopbarSlot side="right">
    <slot />
  </TopbarSlot>
</template>

<style scoped>
.crumbs {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  white-space: nowrap;
}
.crumb {
  color: var(--mt-muted);
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
}
.crumb.link:hover {
  color: var(--mt-accent-text);
}
.sep {
  color: var(--mt-faint);
}
h1 {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -0.01em;
}
</style>
