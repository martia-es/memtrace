<script setup lang="ts">
defineProps<{ label: string; value: string; hint?: string; tone?: "default" | "negative" }>();
</script>

<template>
  <q-card flat bordered class="kpi">
    <q-card-section>
      <div class="text-caption text-grey-7">{{ label }}</div>
      <div class="text-h5 text-weight-medium" :class="{ 'text-negative': tone === 'negative' }">{{ value }}</div>
      <div v-if="hint" class="text-caption text-grey-7">{{ hint }}</div>
    </q-card-section>
  </q-card>
</template>
