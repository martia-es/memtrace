<script setup lang="ts">
import Button from "./Button.vue";
import { t } from "../i18n";

/**
 * Cómo lanzar una evaluación offline, para los estados vacíos de Runs. Con `to` enlaza a los datasets; con el evento
 * `open` (desde un dataset) abre directamente el generador de script.
 */
defineProps<{ to?: { name: string }; datasetId?: string }>();
const emit = defineEmits<{ open: [] }>();
</script>

<template>
  <div class="steps" data-testid="offline-steps">
    <h3>{{ t("offlineRunSteps.no_runs_yet_run_your_first") }}</h3>
    <ol>
      <li><b>{{ t("offlineRunSteps.get_the_script") }}</b>{{ " " + t("offlineRunSteps.open_a_dataset_and_press_the") + " " }}<code>&lt;/&gt;</code>{{ " " + t("offlineRunSteps.button_pick_the_version_the_metrics") }}</li>
      <li><b>{{ t("offlineRunSteps.add_your_keys") }}</b>{{ " " + t("offlineRunSteps.you_get_a") + " " }}<code>.env</code>{{ " " + t("offlineRunSteps.filled_in_only_the_api_keys") }}</li>
      <li><b>{{ t("offlineRunSteps.run_it") }}</b> <code>pip install "memtrace-ai[eval]" httpx python-dotenv</code>{{ t("offlineRunSteps.then") + " " }}<code>python run_eval.py</code>{{ t("offlineRunSteps.the_run_shows_up_here") }}</li>
    </ol>
    <Button v-if="datasetId" variant="primary" data-testid="steps-open" @click="emit('open')">{{ t("offlineRunSteps.get_the_script_for_this_dataset") }}</Button>
    <Button v-else-if="to" variant="primary" :to="to">{{ t("offlineRunSteps.go_to_datasets") }}</Button>
    <p class="muted">{{ t("offlineRunSteps.prefer_your_own_code_call") + " " }}<code>run_experiment(data="…", task=…, evaluators=[…])</code>.</p>
  </div>
</template>

<style scoped>
.steps { max-width: 560px; margin: 48px auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 12px; align-items: flex-start; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-lg); background: var(--mt-card); }
h3 { margin: 0; font-size: 15px; font-weight: 800; letter-spacing: -0.01em; }
ol { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 8px; font-size: 13px; line-height: 1.5; }
.muted { margin: 0; font-size: 12px; color: var(--mt-muted); }
</style>
