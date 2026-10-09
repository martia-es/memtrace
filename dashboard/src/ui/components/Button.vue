<script setup lang="ts">
import { RouterLink, type RouteLocationRaw } from "vue-router";

/**
 * Botón de acción único del dashboard. Sustituye a las clases locales
 * (primary-btn, ghost-btn, adm-btn, small-btn, link-btn, icon-btn, page-btn…).
 * Los atributos (data-testid, aria-*, class, listeners) caen sobre el <button>.
 */
interface Props {
  /** primary = acción principal · secondary = acción neutra con borde · danger = destructiva · link = texto · icon = solo icono */
  variant?: "primary" | "secondary" | "danger" | "link" | "icon";
  size?: "md" | "sm";
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  /** Deshabilita el botón y muestra un spinner antes del texto. */
  loading?: boolean;
  /** Si se indica, se renderiza como enlace de vue-router con el mismo aspecto. */
  to?: RouteLocationRaw;
}

const props = withDefaults(defineProps<Props>(), { variant: "secondary", size: "md", type: "button", disabled: false, loading: false, to: undefined });
</script>

<template>
  <RouterLink v-if="to" :to="to" class="mt-btn" :class="[`v-${variant}`, `s-${size}`]">
    <slot />
  </RouterLink>
  <button v-else :type="type" class="mt-btn" :class="[`v-${variant}`, `s-${size}`, { loading }]" :disabled="disabled || loading" :aria-busy="loading || undefined">
    <span v-if="loading" class="spin" aria-hidden="true" />
    <slot />
  </button>
</template>

<style scoped>
.mt-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font: inherit;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  text-decoration: none;
  border: 1px solid transparent;
  border-radius: var(--mt-radius-lg);
  transition: opacity 0.15s ease, color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}
.mt-btn:focus-visible { outline: 2px solid var(--mt-accent); outline-offset: 2px; }
.mt-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.s-md { height: 36px; padding: 0 16px; font-size: 13px; }
.s-sm { height: 30px; padding: 0 12px; font-size: 12px; }

.v-primary { background: var(--mt-accent); color: var(--mt-accent-ink); }
.v-primary:not(:disabled):hover { opacity: 0.9; }

.v-secondary { background: var(--mt-card); color: var(--mt-ink); border-color: var(--mt-line); }
.v-secondary:not(:disabled):hover { border-color: var(--mt-accent); color: var(--mt-accent-text); }

.v-danger { background: transparent; color: var(--mt-err-ink); border-color: var(--mt-err); }
.v-danger:not(:disabled):hover { background: var(--mt-err-bg); }

.v-link { height: auto; padding: 0; background: none; color: var(--mt-accent-text); border: none; border-radius: var(--mt-radius-xs); }
.v-link:not(:disabled):hover { text-decoration: underline; }

.v-icon { width: 28px; height: 28px; padding: 0; background: transparent; color: var(--mt-muted); border-radius: var(--mt-radius-sm); }
.v-icon:not(:disabled):hover { background: var(--mt-soft); color: var(--mt-ink); }
.v-icon.s-md { width: 36px; height: 36px; }

.spin {
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: mt-btn-spin 0.7s linear infinite;
}
@keyframes mt-btn-spin { to { transform: rotate(360deg); } }
</style>
