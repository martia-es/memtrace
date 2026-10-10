<script setup lang="ts">
import { ref, watch } from "vue";

/**
 * Panel de una vista por pestañas. Se monta la primera vez que se activa (carga perezosa) y después
 * solo se oculta, de modo que conserva su estado al volver a ella (como un keep-alive).
 */
const props = defineProps<{ active: boolean }>();
const visited = ref(props.active);
watch(() => props.active, (on) => { if (on) visited.value = true; });
</script>

<template>
  <div v-if="visited" v-show="active" role="tabpanel"><slot /></div>
</template>
