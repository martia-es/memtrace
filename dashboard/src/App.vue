<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import MainLayout from "./ui/layouts/MainLayout.vue";

// login y el selector de experimento no llevan sidebar (aún no hay experimento sobre el que navegar)
const route = useRoute();
const bare = computed(() => route.meta.bare === true);
</script>

<template>
  <router-view v-if="bare" />
  <MainLayout v-else />
</template>
