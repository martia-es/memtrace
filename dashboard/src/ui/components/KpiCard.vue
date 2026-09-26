<script setup lang="ts">
defineProps<{ label: string; value: string; hint?: string; tone?: "default" | "negative" }>();
</script>

<template>
  <q-card flat class="kpi mt-card">
    <q-card-section class="kpi-body">
      <div class="label">{{ label }}</div>
      <div class="value" :class="{ negative: tone === 'negative' }">{{ value }}</div>
      <div v-if="hint" class="hint">{{ hint }}</div>
    </q-card-section>
  </q-card>
</template>

<style scoped>
.kpi {
  box-sizing: border-box;
  height: 100%;
  border: 1px solid var(--mt-line);
  background: linear-gradient(180deg, #ffffff 0%, #fbfdfb 100%);
  overflow: hidden;
  font-family: var(--mt-sans);
}
.kpi-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 100%;
  padding: 18px;
}
.label {
  color: #c4f26b;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  text-shadow: 0 0 0 rgba(74, 50, 201, 0.12);
}
.value {
  color: var(--mt-ink);
  font-size: clamp(1.5rem, 2.4vw, 2.1rem);
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.05em;
}
.value.negative {
  color: var(--mt-err-ink);
}
.hint {
  color: var(--mt-muted);
  font-size: 12px;
  line-height: 1.35;
}
</style>
