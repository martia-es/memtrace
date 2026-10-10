<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";

/**
 * Menú desplegable propio. Se coloca como hijo del elemento que lo abre (el disparador): un clic en él lo
 * abre o cierra; clic fuera o Esc lo cierran; con `autoClose` se cierra al elegir algo dentro.
 * El panel se pinta en <body> con posición fija (no lo recortan tablas ni modales).
 * `anchor`/`self` usan la misma notación que el resto del diseño: "bottom left", "top right"…
 *  - anchor: punto del disparador al que se ancla; self: punto del panel que se hace coincidir con él.
 * Los atributos (class, data-testid…) caen sobre el panel.
 */
defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<{ anchor?: string; self?: string; offset?: [number, number]; fit?: boolean; autoClose?: boolean }>(), {
  anchor: "bottom left",
  self: "top left",
  offset: () => [0, 0],
  fit: false,
  autoClose: false,
});
const emit = defineEmits<{ "before-show": []; hide: [] }>();

const marker = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const open = ref(false);
const style = ref<Record<string, string>>({});
let trigger: HTMLElement | null = null;

async function place() {
  if (!trigger) return;
  await nextTick();
  const r = trigger.getBoundingClientRect();
  const w = panel.value?.offsetWidth ?? 0;
  const h = panel.value?.offsetHeight ?? 0;
  const ax = props.anchor.includes("right") ? r.right : r.left;
  const ay = props.anchor.includes("bottom") ? r.bottom : r.top;
  let left = ax - (props.self.includes("right") ? w : 0) + props.offset[0];
  let top = ay - (props.self.includes("bottom") ? h : 0) + props.offset[1];
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
  style.value = { left: `${left}px`, top: `${top}px`, ...(props.fit ? { minWidth: `${r.width}px` } : {}) };
}

function show() {
  emit("before-show");
  open.value = true;
  void place();
}
function hide() {
  if (!open.value) return;
  open.value = false;
  emit("hide");
}
const toggle = () => (open.value ? hide() : show());
const onDocDown = (e: MouseEvent) => {
  const t = e.target as Node;
  if (open.value && !panel.value?.contains(t) && !trigger?.contains(t)) hide();
};
const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") hide(); };

onMounted(() => {
  trigger = marker.value?.parentElement ?? null;
  trigger?.addEventListener("click", toggle);
  document.addEventListener("mousedown", onDocDown);
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", hide);
});
onBeforeUnmount(() => {
  trigger?.removeEventListener("click", toggle);
  document.removeEventListener("mousedown", onDocDown);
  document.removeEventListener("keydown", onKey);
  window.removeEventListener("resize", hide);
});

defineExpose({ show, hide });
</script>

<template>
  <span ref="marker" class="mt-menu-marker" hidden />
  <Teleport to="body">
    <div v-if="open" ref="panel" class="mt-menu" role="menu" :style="style" v-bind="$attrs" @click="autoClose && hide()"><slot /></div>
  </Teleport>
</template>

<style>
/* El panel vive en <body>: estilo global y acotado por su clase */
.mt-menu {
  position: fixed;
  z-index: 3000;
  max-height: 70vh;
  overflow: auto;
  background: var(--mt-card);
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-lg);
  box-shadow: var(--mt-shadow-float);
  color: var(--mt-ink);
}
</style>
