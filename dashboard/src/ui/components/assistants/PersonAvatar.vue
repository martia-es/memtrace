<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { personInitials, personLabel } from "@/domain/assistants";

/** Foto de perfil de una persona; si no tiene, o no carga, sus iniciales. */
const props = defineProps<{ name: string | null; email: string; image: string | null; size?: number }>();

const failed = ref(false);
watch(() => props.image, () => (failed.value = false));
const showImage = computed(() => !!props.image && !failed.value);
const px = computed(() => `${props.size ?? 24}px`);
</script>

<template>
  <span class="person" :style="{ width: px, height: px }" :title="personLabel({ name, email })">
    <!-- sin referrer: algunas fotos (Google) no se sirven si la petición viene de otra web -->
    <img v-if="showImage" :src="image!" :alt="personLabel({ name, email })" referrerpolicy="no-referrer" loading="lazy" @error="failed = true" />
    <template v-else>{{ personInitials({ name, email }) }}</template>
  </span>
</template>

<style scoped>
.person {
  display: inline-grid;
  place-items: center;
  flex: none;
  box-sizing: border-box;
  overflow: hidden;
  border: 2px solid var(--mt-card);
  border-radius: 50%;
  font-size: 9.5px;
  font-weight: 800;
  background: var(--mt-accent-soft);
  color: var(--mt-accent-text);
}
.person img { width: 100%; height: 100%; object-fit: cover; display: block; }
</style>
