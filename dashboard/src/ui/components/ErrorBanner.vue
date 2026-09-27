<script setup lang="ts">
import { computed } from "vue";
import { ApiError } from "@/application/trace-api";

const props = defineProps<{ error: Error }>();
defineEmits<{ retry: [] }>();

const message = computed(() => {
  const e = props.error;
  if (e instanceof ApiError) {
    if (e.status === 0) return "Could not reach the API. Is it running (`npm run dev` in api/) and does the proxy point to it?";
    if (e.status === 503) return "The trace store (ClickHouse) is not responding. Check `make status`.";
    if (e.status === 404) return "Not found. If it's a trace, it may be outside the retention period (30 days).";
    return e.detail ?? e.title;
  }
  return e.message;
});
</script>

<template>
  <q-banner rounded class="bg-negative text-white" role="alert">
    <template #avatar><q-icon name="error_outline" /></template>
    {{ message }}
    <template #action><q-btn flat label="Retry" @click="$emit('retry')" /></template>
  </q-banner>
</template>
