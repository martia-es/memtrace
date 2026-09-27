<script setup lang="ts">
import { computed } from "vue";
import Select from "./Select.vue";

interface Props {
  modelValue: string | null;
  options: string[];
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), { loading: false });
const emit = defineEmits<{ "update:modelValue": [value: string | null] }>();

const selectOptions = computed(() =>
  props.options.map((s) => ({ label: s, value: s }))
);

const handleUpdate = (value: string) => {
  emit("update:modelValue", value === props.modelValue ? null : value);
};
</script>

<template>
  <Select
    :model-value="modelValue"
    :options="selectOptions"
    :loading="loading"
    placeholder="Select agent"
    @update:model-value="handleUpdate"
  />
</template>
