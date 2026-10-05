<script setup lang="ts">
import { computed, inject, reactive, ref, watch } from "vue";
import { useQuasar } from "quasar";
import type { OrganizationDto, OrganizationThemeDto } from "@/application/identity-api";
import { CURRENT_EXPERIMENT } from "@/dependency-container";
import { useIdentityApi } from "../../composables/useIdentityApi";
import { applyOrganizationTheme } from "../../composables/useOrganizationTheme";
import { notifyErrorWith } from "../../composables/useAdminDirectory";

/** Apariencia de la organización (ADR-019): color de acento y estilo de esquinas. Solo org_admin la cambia. */
const props = defineProps<{ organization: OrganizationDto; canManage: boolean }>();
const emit = defineEmits<{ saved: [] }>();

const api = useIdentityApi();
const $q = useQuasar();
const currentExperiment = inject(CURRENT_EXPERIMENT, computed(() => null));

const DEFAULT_ACCENT = "#00857f";
// "Default" = sin override: el 4/6/8 px del diseño Mediterráneo (ADR-048); el resto lo reemplaza
const RADIUS_OPTIONS: { label: string; value: OrganizationThemeDto["radiusPreset"] }[] = [
  { label: "Default", value: null },
  { label: "Sharp", value: "sharp" as const },
  { label: "Soft", value: "soft" as const },
  { label: "Round", value: "round" as const },
];

const draft = reactive<OrganizationThemeDto>({ accentColor: null, radiusPreset: null });
const saving = ref(false);

function syncDraft(theme: OrganizationThemeDto) {
  draft.accentColor = theme.accentColor;
  draft.radiusPreset = theme.radiusPreset;
}
watch(() => props.organization, (org) => syncDraft(org.theme), { immediate: true });

const dirty = computed(() => draft.accentColor !== props.organization.theme.accentColor || draft.radiusPreset !== props.organization.theme.radiusPreset);

async function save() {
  saving.value = true;
  try {
    const updated = await api.updateOrganizationTheme(props.organization.id, { ...draft });
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
  draft.accentColor = null;
  draft.radiusPreset = null;
}
</script>

<template>
  <div class="appearance">
    <p class="adm-hint">
      Changes only the accent color and corner style of the dashboard while someone is working in this organization's experiments.
      Everything else stays the same.
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

      <div v-if="canManage" class="actions">
        <button class="adm-btn ghost" type="button" @click="reset">Reset to default</button>
        <button class="adm-btn primary" type="button" :disabled="saving || !dirty" @click="save">Save appearance</button>
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
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
