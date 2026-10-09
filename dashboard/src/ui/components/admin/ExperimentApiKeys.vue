<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useQuasar } from "quasar";
import type { ApiKeyDto, ExperimentDto } from "@/application/identity-api";
import { useIdentityApi } from "../../composables/useIdentityApi";
import { formatDate, notifyErrorWith } from "../../composables/useAdminDirectory";
import Button from "../Button.vue";

/**
 * API keys de un experimento (ADR-013). Una clave identifica al experimento cuando un agente envía trazas.
 * El valor completo solo se muestra una vez, justo después de crearla.
 */
const props = defineProps<{ experiment: ExperimentDto; canManage: boolean }>();

const api = useIdentityApi();
const $q = useQuasar();

const keys = ref<ApiKeyDto[]>([]);
const loading = ref(true);
const generating = ref(false);
const revealed = ref<string | null>(null);

async function load() {
  loading.value = true;
  try {
    keys.value = await api.listApiKeys(props.experiment.id);
  } catch (error) {
    notifyErrorWith($q.notify, "Could not load API keys", error);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function generate() {
  generating.value = true;
  try {
    const created = await api.createApiKey(props.experiment.id);
    revealed.value = created.plaintext;
    keys.value = await api.listApiKeys(props.experiment.id);
  } catch (error) {
    notifyErrorWith($q.notify, "Could not create API key", error);
  } finally {
    generating.value = false;
  }
}

async function revoke(keyId: string) {
  try {
    await api.revokeApiKey(props.experiment.id, keyId);
    keys.value = await api.listApiKeys(props.experiment.id);
  } catch (error) {
    notifyErrorWith($q.notify, "Could not revoke API key", error);
  }
}

function envSnippet(key: string): string {
  return `MEMTRACE_SERVICE_NAME="${props.experiment.serviceName}"
MEMTRACE_OTLP_PROTOCOL="http"
MEMTRACE_OTLP_ENDPOINT="${window.location.origin}/api/v1/ingest"
MEMTRACE_OTLP_HEADERS="Authorization=Bearer ${key}"
MEMTRACE_CAPTURE_CONTENT="true"`;
}

function copy(text: string) {
  void navigator.clipboard.writeText(text);
  $q.notify({ message: "Copied", timeout: 1200, position: "bottom" });
}
</script>

<template>
  <div class="api-keys">
    <p class="adm-hint">
      An API key lets your agent send traces to <strong>{{ experiment.name }}</strong>. Keys are tied to this experiment only.
      The full value is shown once, right after you create it: copy it then.
    </p>

    <div v-if="revealed" class="adm-card revealed">
      <p class="revealed-title">New key created. Copy it now, it won't be shown again.</p>
      <div class="adm-snippet">
        <pre>{{ envSnippet(revealed) }}</pre>
        <Button @click="copy(envSnippet(revealed))">Copy</Button>
      </div>
      <Button size="sm" @click="revealed = null" class="dismiss">I've copied it</Button>
    </div>

    <div class="toolbar-row">
      <h4 class="adm-section-title">Active keys ({{ keys.length }})</h4>
      <Button variant="primary" v-if="canManage" :disabled="generating" @click="generate">Create API key</Button>
    </div>

    <ul v-if="keys.length" class="adm-list">
      <li v-for="k in keys" :key="k.id" class="adm-item">
        <div class="adm-item-main">
          <span class="adm-item-title mono">{{ k.keyPrefix }}…</span>
          <span class="adm-item-meta">created {{ formatDate(k.createdAt) }} · last used {{ formatDate(k.lastUsedAt) }}</span>
        </div>
        <Button variant="danger" v-if="canManage" @click="revoke(k.id)">Revoke</Button>
      </li>
    </ul>
    <p v-else-if="!loading" class="adm-empty">
      No API keys yet.
      <template v-if="canManage">Create one, then follow the <em>Connect</em> tab to configure your agent.</template>
      <template v-else>An experiment admin needs to create one.</template>
    </p>

    <p v-if="!canManage && keys.length" class="adm-hint">You can only see and revoke the keys you created.</p>
  </div>
</template>

<style scoped>
.api-keys {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.adm-hint strong {
  color: var(--mt-ink);
  font-weight: 600;
}
.revealed {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--mt-accent);
}
.revealed-title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
}
.dismiss {
  align-self: flex-start;
}
.toolbar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.mono {
  font-family: var(--mt-mono);
}
.adm-section-title {
  margin: 0;
}
</style>
