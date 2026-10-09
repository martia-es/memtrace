<script setup lang="ts">
import { computed, inject, reactive, ref, watch } from "vue";
import { useQuasar } from "quasar";
import { EMPTY_THEME, type OrganizationDto, type OrganizationThemeDto } from "@/application/identity-api";
import { CURRENT_EXPERIMENT } from "@/dependency-container";
import { useIdentityApi } from "../../composables/useIdentityApi";
import { applyOrganizationTheme, themeCssVars } from "../../composables/useOrganizationTheme";
import { ASSISTANT_DISPLAY_MODES, MODE_LABELS, type AssistantDisplayMode } from "@/domain/assistant-display";
import { notifyErrorWith } from "../../composables/useAdminDirectory";
import Button from "../Button.vue";

/** Apariencia de la organización (ADR-019, ADR-063): colores, esquinas, fuente y cómo se ve el asistente. Solo org_admin la cambia. */
const props = defineProps<{ organization: OrganizationDto; canManage: boolean }>();
const emit = defineEmits<{ saved: [] }>();

const api = useIdentityApi();
const $q = useQuasar();
const currentExperiment = inject(CURRENT_EXPERIMENT, computed(() => null));

const DEFAULT_ACCENT = "#00857f";
const DEFAULT_SECONDARY = "#ff6b4a";
// "Default" = sin override: el 4/6/8 px del diseño Mediterráneo (ADR-048); el resto lo reemplaza
const RADIUS_OPTIONS: { label: string; value: OrganizationThemeDto["radiusPreset"] }[] = [
  { label: "Default", value: null },
  { label: "Sharp", value: "sharp" as const },
  { label: "Soft", value: "soft" as const },
  { label: "Round", value: "round" as const },
];

const FONT_OPTIONS: { label: string; value: OrganizationThemeDto["fontPreset"] }[] = [
  { label: "Default", value: null },
  { label: "System", value: "system" },
  { label: "Serif", value: "serif" },
  { label: "Humanist", value: "humanist" },
];

const draft = reactive<OrganizationThemeDto>({ ...EMPTY_THEME });
const saving = ref(false);

function syncDraft(theme: OrganizationThemeDto) {
  Object.assign(draft, theme, { assistantAllowedModes: theme.assistantAllowedModes ? [...theme.assistantAllowedModes] : null });
}
watch(() => props.organization, (org) => syncDraft(org.theme), { immediate: true });

const dirty = computed(() => JSON.stringify(draft) !== JSON.stringify(props.organization.theme));

// modos que la organización ofrece: null = todos. El modo por defecto siempre es uno de ellos.
const allowed = computed(() => draft.assistantAllowedModes ?? [...ASSISTANT_DISPLAY_MODES]);
function toggleMode(mode: AssistantDisplayMode) {
  const next = allowed.value.includes(mode) ? allowed.value.filter((m) => m !== mode) : ASSISTANT_DISPLAY_MODES.filter((m) => m === mode || allowed.value.includes(m));
  if (next.length === 0) return; // al menos un modo
  draft.assistantAllowedModes = next.length === ASSISTANT_DISPLAY_MODES.length ? null : [...next];
  if (draft.assistantDefaultMode && !next.includes(draft.assistantDefaultMode)) draft.assistantDefaultMode = null;
}

// la vista previa pinta con las mismas variables que aplicará el tema, pero acotadas a este recuadro
const previewStyle = computed(() => themeCssVars(draft));
const previewName = computed(() => draft.assistantName?.trim() || "Weather Assistant");

async function save() {
  saving.value = true;
  try {
    const updated = await api.updateOrganizationTheme(props.organization.id, { ...draft, assistantName: draft.assistantName?.trim() || null });
    // aplica ya el cambio si la organización es la del experimento abierto; si no, MainLayout lo hará al navegar
    if (currentExperiment.value?.organizationId === props.organization.id) applyOrganizationTheme(updated.theme);
    emit("saved");
    $q.notify({ message: "Appearance updated", color: "positive", timeout: 2000 });
  } catch (error) {
    notifyErrorWith($q.notify, "Could not update appearance", error);
  } finally {
    saving.value = false;
  }
}

function reset() {
  Object.assign(draft, EMPTY_THEME);
}
</script>

<template>
  <div class="appearance">
    <p class="adm-hint">
      Brand the dashboard and the assistant chat for everyone working in this organization's experiments.
      MemTrace's logo and the colors of charts and spans stay the same.
    </p>

    <div class="adm-card appearance-form">
      <div class="field">
        <span class="field-label">Accent color</span>
        <div class="color-input">
          <input v-if="canManage" type="color" :value="draft.accentColor ?? DEFAULT_ACCENT" aria-label="Accent color" @input="draft.accentColor = ($event.target as HTMLInputElement).value" />
          <span class="adm-code">{{ draft.accentColor ?? "default" }}</span>
        </div>
      </div>

      <div class="field">
        <span class="field-label">Corner style</span>
        <div class="mt-segmented small">
          <button
            v-for="opt in RADIUS_OPTIONS"
            :key="opt.label"
            type="button"
            :disabled="!canManage"
            :aria-pressed="draft.radiusPreset === opt.value"
            @click="draft.radiusPreset = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <div class="field">
        <span class="field-label">Secondary color</span>
        <div class="color-input">
          <input v-if="canManage" type="color" :value="draft.secondaryColor ?? DEFAULT_SECONDARY" aria-label="Secondary color" @input="draft.secondaryColor = ($event.target as HTMLInputElement).value" />
          <span class="adm-code">{{ draft.secondaryColor ?? "default" }}</span>
          <Button v-if="canManage && draft.secondaryColor" @click="draft.secondaryColor = null">Clear</Button>
        </div>
      </div>

      <div class="field">
        <span class="field-label">Font</span>
        <div class="mt-segmented small">
          <button v-for="opt in FONT_OPTIONS" :key="opt.label" type="button" :disabled="!canManage" :aria-pressed="draft.fontPreset === opt.value" @click="draft.fontPreset = opt.value">{{ opt.label }}</button>
        </div>
      </div>

      <h4 class="section">Assistant</h4>

      <div class="field">
        <label class="field-label" for="assistant-name">Assistant name</label>
        <input id="assistant-name" v-model="draft.assistantName" class="text-input" type="text" maxlength="40" placeholder="Name of the agent" :disabled="!canManage" />
      </div>

      <div class="field">
        <span class="field-label">Available views</span>
        <div class="mt-segmented small">
          <button v-for="m in ASSISTANT_DISPLAY_MODES" :key="m" type="button" :disabled="!canManage" :aria-pressed="allowed.includes(m)" :data-testid="`allow-${m}`" @click="toggleMode(m)">{{ MODE_LABELS[m] }}</button>
        </div>
      </div>

      <div class="field">
        <span class="field-label">Default view</span>
        <div class="mt-segmented small">
          <button v-for="m in allowed" :key="m" type="button" :disabled="!canManage" :aria-pressed="(draft.assistantDefaultMode ?? allowed[0]) === m" :data-testid="`default-${m}`" @click="draft.assistantDefaultMode = m">{{ MODE_LABELS[m] }}</button>
        </div>
      </div>

      <div class="preview" :style="previewStyle" aria-label="Preview" data-testid="appearance-preview">
        <div class="preview-bar"><span class="preview-dot" aria-hidden="true" /><b>{{ previewName }}</b><span class="preview-env">PRO</span><span class="preview-tag">Highlight</span></div>
        <div class="preview-msg agent">Hi! Ask me about the weather in any city.</div>
        <div class="preview-msg user">What is it like in Seville?</div>
        <button type="button" class="preview-send" tabindex="-1">Send</button>
      </div>

      <div v-if="canManage" class="actions">
        <Button @click="reset">Reset to default</Button>
        <Button variant="primary" :disabled="saving || !dirty" @click="save">Save appearance</Button>
      </div>
      <p v-else class="adm-hint">Only an org_admin can change this.</p>
    </div>
  </div>
</template>

<style scoped>
.appearance {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.appearance-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.field-label {
  font-size: 13px;
  font-weight: 600;
}
.color-input {
  display: flex;
  align-items: center;
  gap: 10px;
}
.color-input input[type="color"] {
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-sm);
  background: none;
  cursor: pointer;
}
.section {
  margin: 4px 0 -6px;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--mt-muted);
}
.text-input {
  width: 220px;
  padding: 7px 10px;
  font: inherit;
  color: var(--mt-ink);
  background: var(--mt-card);
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-sm);
}
.preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  font-family: var(--mt-sans);
  background: var(--mt-bg);
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-lg);
}
.preview-bar { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.preview-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--mt-accent); }
.preview-env { font-family: var(--mt-mono); font-size: 11px; color: var(--mt-muted); }
.preview-tag { margin-left: auto; padding: 1px 8px; font-size: 11px; font-weight: 700; color: var(--mt-highlight-ink); background: var(--mt-highlight-soft); border-radius: var(--mt-radius-xs); }
.preview-msg { max-width: 80%; padding: 8px 11px; font-size: 13px; border-radius: calc(var(--mt-radius-lg) + 4px); }
.preview-msg.agent { align-self: flex-start; color: var(--mt-ink); background: color-mix(in srgb, var(--mt-accent) 9%, var(--mt-card)); border-bottom-left-radius: var(--mt-radius-xs); }
.preview-msg.user { align-self: flex-end; color: var(--mt-accent-ink); background: var(--mt-accent); border-bottom-right-radius: var(--mt-radius-xs); }
.preview-send { align-self: flex-end; padding: 6px 14px; font: inherit; font-size: 13px; font-weight: 700; color: var(--mt-accent-ink); background: var(--mt-accent); border: none; border-radius: var(--mt-radius-sm); }
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
