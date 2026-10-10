<script setup lang="ts">
import Spinner from "./Spinner.vue";

/** Estado de carga centrado de una zona (página, tarjeta o panel). El tamaño marca también el aire alrededor. */
withDefaults(defineProps<{ size?: "sm" | "md" | "lg" }>(), { size: "lg" });
</script>

<template>
  <div class="mt-loading" :class="`s-${size}`"><Spinner :size="size" /></div>
</template>

<style scoped>
.mt-loading { display: flex; align-items: center; justify-content: center; }
.s-sm { padding: 10px; }
.s-md { padding: 24px; }
.s-lg { padding: 60px; }
</style>
