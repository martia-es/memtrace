<script setup lang="ts">
import { computed } from "vue";
import { describeApiError } from "@/application/describe-api-error";

const props = defineProps<{ error: Error }>();
defineEmits<{ retry: [] }>();

const message = computed(() => describeApiError(props.error));
</script>

<template>
  <q-banner rounded class="bg-negative text-white" role="alert">
    <template #avatar><q-icon name="error_outline" /></template>
    {{ message }}
    <template #action><q-btn flat label="Retry" @click="$emit('retry')" /></template>
  </q-banner>
</template>
