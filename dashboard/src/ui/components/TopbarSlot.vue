<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { useTopbar } from "../composables/useTopbar";

const props = defineProps<{ side: "left" | "right" }>();
const { leftEl, rightEl, leftCount } = useTopbar();
const target = computed(() => (props.side === "left" ? leftEl.value : rightEl.value));

onMounted(() => {
  if (props.side === "left") leftCount.value++;
});
onBeforeUnmount(() => {
  if (props.side === "left") leftCount.value--;
});
</script>

<template>
  <!-- sin topbar (p. ej. página montada suelta) se pinta en su sitio -->
  <Teleport :to="target ?? 'body'" :disabled="!target">
    <slot />
  </Teleport>
</template>
