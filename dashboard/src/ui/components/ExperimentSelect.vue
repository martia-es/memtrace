<script setup lang="ts">
import { computed } from "vue";
import type { ExperimentDto } from "@/application/identity-api";
import Select from "./Select.vue";

interface Props {
  modelValue: string | null;
  options: ExperimentDto[];
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), { loading: false });
const emit = defineEmits<{ "update:modelValue": [value: string | null] }>();

const selectOptions = computed(() => props.options.map((e) => ({ label: e.name, value: e.id })));

const handleUpdate = (value: string) => emit("update:modelValue", value);
</script>

<template>
  <Select
    :model-value="modelValue"
    :options="selectOptions"
    :loading="loading"
    placeholder="Select experiment"
    @update:model-value="handleUpdate"
  />
</template>
