<script setup lang="ts">
import Button from "./Button.vue";

/**
 * Cómo lanzar una evaluación offline, para los estados vacíos de Runs. Con `to` enlaza a los datasets; con el evento
 * `open` (desde un dataset) abre directamente el generador de script.
 */
defineProps<{ to?: { name: string }; datasetId?: string }>();
const emit = defineEmits<{ open: [] }>();
</script>

<template>
  <div class="steps" data-testid="offline-steps">
    <h3>No runs yet: run your first evaluation</h3>
    <ol>
      <li><b>Get the script.</b> Open a dataset and press the <code>&lt;/&gt;</code> button: pick the version, the metrics and the agent environment.</li>
      <li><b>Add your keys.</b> You get a <code>.env</code> filled in; only the API keys are left for you to paste (Experiment › API keys).</li>
      <li><b>Run it.</b> <code>pip install "memtrace-ai[eval]" httpx python-dotenv</code>, then <code>python run_eval.py</code>. The run shows up here.</li>
    </ol>
    <Button v-if="datasetId" variant="primary" data-testid="steps-open" @click="emit('open')">Get the script for this dataset</Button>
    <Button v-else-if="to" variant="primary" :to="to">Go to datasets</Button>
    <p class="muted">Prefer your own code? Call <code>run_experiment(data="…", task=…, evaluators=[…])</code>.</p>
  </div>
</template>

<style scoped>
.steps { max-width: 560px; margin: 48px auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 12px; align-items: flex-start; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-lg); background: var(--mt-card); }
h3 { margin: 0; font-size: 15px; font-weight: 800; letter-spacing: -0.01em; }
ol { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 8px; font-size: 13px; line-height: 1.5; }
.muted { margin: 0; font-size: 12px; color: var(--mt-muted); }
</style>
