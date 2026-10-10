<script setup lang="ts">
/**
 * Interruptor de encendido y apagado para algo que se activa al instante (pausar una alerta). Se anuncia como `switch`
 * con aria-checked; el nombre accesible lo pone quien lo usa con `aria-label`. Atributos y @click caen sobre el <button>.
 */
withDefaults(defineProps<{ on?: boolean }>(), { on: false });
</script>

<template>
  <button type="button" class="mt-switch" :class="{ on }" role="switch" :aria-checked="on"><span /></button>
</template>

<style scoped>
.mt-switch { width: 34px; height: 20px; flex: none; padding: 0; border: 0; border-radius: 10px; background: var(--mt-faint, #8a9a98); position: relative; cursor: pointer; }
.mt-switch span { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left 0.12s ease; }
.mt-switch.on { background: var(--mt-accent); }
.mt-switch.on span { left: 16px; }
.mt-switch:focus-visible { outline: 2px solid var(--mt-accent); outline-offset: 2px; }
</style>
