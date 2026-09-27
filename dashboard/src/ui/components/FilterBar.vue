<script setup lang="ts">
import { RANGE_PRESETS, type RangeKey } from "@/domain/time-range";

defineProps<{ range: RangeKey; loading: boolean }>();
defineEmits<{ "update:range": [RangeKey]; refresh: [] }>();
</script>

<template>
  <div class="row items-center q-gutter-sm">
    <q-btn-toggle
      :model-value="range"
      :options="RANGE_PRESETS.map((p) => ({ label: p.label, value: p.key }))"
      dense
      no-caps
      unelevated
      toggle-color="primary"
      class="toggle-group"
      aria-label="Time range"
      @update:model-value="$emit('update:range', $event)"
    />
    <slot />
    <q-space />
    <q-btn flat round dense icon="refresh" :loading="loading" aria-label="Refresh" @click="$emit('refresh')" />
  </div>
</template>
