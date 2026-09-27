<script setup lang="ts">
withDefaults(
  defineProps<{
    crumbs: { label: string; to?: { name: string; params?: Record<string, string> } }[];
    icon: string;
    title: string;
  }>(),
  {},
);
</script>

<template>
  <header class="page-header">
    <nav class="crumbs" aria-label="Breadcrumb">
      <template v-for="(c, i) in crumbs" :key="i">
        <router-link v-if="c.to" :to="c.to" class="crumb link">{{ c.label }}</router-link>
        <span v-else class="crumb current">{{ c.label }}</span>
        <span v-if="i < crumbs.length - 1" class="sep">/</span>
      </template>
    </nav>
    <div class="title-row">
      <div class="title-main">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon"><path :d="icon" /></svg>
        <h1>{{ title }}</h1>
      </div>
      <div class="title-actions">
        <slot />
      </div>
    </div>
  </header>
</template>

<style scoped>
.page-header {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}
.crumbs {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--mt-muted);
}
.crumb.link {
  color: var(--mt-muted);
  text-decoration: none;
}
.crumb.link:hover {
  color: var(--mt-ink);
  text-decoration: underline;
}
.crumb.current {
  color: var(--mt-muted);
}
.sep {
  color: var(--mt-line);
}
.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.title-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.icon {
  flex-shrink: 0;
  color: var(--mt-ink);
}
.title-main h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.03em;
}
.title-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
</style>
