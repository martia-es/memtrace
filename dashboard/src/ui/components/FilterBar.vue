<script setup lang="ts">
import { RANGE_PRESETS, type RangeKey } from "@/domain/time-range";

defineProps<{ range: RangeKey; service: string | undefined; services: string[]; loading: boolean }>();
defineEmits<{ "update:range": [RangeKey]; "update:service": [string | null]; refresh: [] }>();
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
      aria-label="Rango de tiempo"
      @update:model-value="$emit('update:range', $event)"
    />
    <q-select
      :model-value="service ?? null"
      :options="services"
      label="Servicio"
      dense
      outlined
      clearable
      options-dense
      style="min-width: 200px"
      @update:model-value="$emit('update:service', $event)"
    />
    <slot />
    <q-space />
    <q-btn flat round dense icon="refresh" :loading="loading" aria-label="Actualizar" @click="$emit('refresh')" />
  </div>
</template>
