<script setup lang="ts">
import Pill from "./Pill.vue";

/** Chip de estado del diseño (ADR-048): `Pill` con punto + etiqueta; el color solo comunica estado. */
withDefaults(defineProps<{ tone?: "ok" | "error" | "warn" | "info" | "highlight" | "neutral"; label: string }>(), { tone: "neutral" });
</script>

<template>
  <Pill :tone="tone" dot>{{ label }}</Pill>
</template>
