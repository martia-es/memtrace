<script setup lang="ts">
defineProps<{ icon: string; title: string }>();
</script>

<template>
  <div class="column items-center q-pa-xl text-grey-7 text-center">
    <q-icon :name="icon" size="56px" />
    <div class="text-subtitle1 q-mt-sm">{{ title }}</div>
    <div class="text-caption q-mt-xs"><slot /></div>
  </div>
</template>
