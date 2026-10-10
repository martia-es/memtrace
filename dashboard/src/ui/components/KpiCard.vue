<script setup lang="ts">
import Card from "./Card.vue";
defineProps<{ label: string; value: string; hint?: string; tone?: "default" | "positive" | "warning" | "negative" }>();
</script>

<template>
  <Card as="div" padding="none" block class="kpi">
    <q-card-section class="kpi-body">
      <div class="label">{{ label }}</div>
      <div class="value" :class="tone">{{ value }}</div>
      <div v-if="hint" class="hint">{{ hint }}</div>
    </q-card-section>
  </Card>
</template>

<style scoped>
.kpi {
  box-sizing: border-box;
  height: 100%;
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
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
  color: var(--mt-accent);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.value {
  color: var(--mt-ink);
  font-size: clamp(1.5rem, 2.4vw, 2.1rem);
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.05em;
}
.value.positive {
  color: var(--mt-ok-ink);
}
.value.warning {
  color: var(--mt-warn-ink);
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
