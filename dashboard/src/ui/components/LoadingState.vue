<script setup lang="ts">
import Spinner from "./Spinner.vue";

/** Estado de carga centrado de una zona (página, tarjeta o panel). El tamaño marca también el aire alrededor; `lg` ocupa buena parte de la altura para que el loader quede centrado; `fill` lo extiende a casi toda la pantalla. */
withDefaults(defineProps<{ size?: "sm" | "md" | "lg"; fill?: boolean }>(), { size: "lg", fill: false });
</script>

<template>
  <div class="mt-loading" :class="[`s-${size}`, { fill }]"><Spinner :size="size" /></div>
</template>

<style scoped>
.mt-loading { display: flex; align-items: center; justify-content: center; }
.s-sm { padding: 10px; }
.s-md { padding: 24px; }
.s-lg { min-height: min(60vh, 480px); padding: 24px; }
.fill { min-height: 80vh; }
</style>
