<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useQuasar } from "quasar";
import type { ApiKeyDto, ExperimentDto } from "@/application/identity-api";
import { useIdentityApi } from "../../composables/useIdentityApi";
import { formatDate, notifyErrorWith } from "../../composables/useAdminDirectory";
import Button from "../Button.vue";
import { t } from "../../i18n";

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
    notifyErrorWith($q.notify, t("experimentApiKeys.could_not_load_api_keys"), error);
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
    notifyErrorWith($q.notify, t("experimentApiKeys.could_not_create_api_key"), error);
  } finally {
    generating.value = false;
  }
}

async function revoke(keyId: string) {
  try {
    await api.revokeApiKey(props.experiment.id, keyId);
    keys.value = await api.listApiKeys(props.experiment.id);
  } catch (error) {
    notifyErrorWith($q.notify, t("experimentApiKeys.could_not_revoke_api_key"), error);
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
  $q.notify({ message: t("experimentApiKeys.copied"), timeout: 1200, position: "bottom" });
}
</script>

<template>
  <div class="api-keys">
    <p class="adm-hint">
      {{ t("experimentApiKeys.an_api_key_lets_your_agent") + " " }}<strong>{{ experiment.name }}</strong>{{ t("experimentApiKeys.keys_are_tied_to_this_experiment") }}
    </p>

    <div v-if="revealed" class="adm-card revealed">
      <p class="revealed-title">{{ t("experimentApiKeys.new_key_created_copy_it_now") }}</p>
      <div class="adm-snippet">
        <pre>{{ envSnippet(revealed) }}</pre>
        <Button @click="copy(envSnippet(revealed))">{{ t("experimentApiKeys.copy") }}</Button>
      </div>
      <Button size="sm" @click="revealed = null" class="dismiss">{{ t("experimentApiKeys.i_ve_copied_it") }}</Button>
    </div>

    <div class="toolbar-row">
      <h4 class="adm-section-title">{{ t("experimentApiKeys.active_keys_count", { count: keys.length }) }}</h4>
      <Button variant="primary" v-if="canManage" :disabled="generating" @click="generate">{{ t("experimentApiKeys.create_api_key") }}</Button>
    </div>

    <ul v-if="keys.length" class="adm-list">
      <li v-for="k in keys" :key="k.id" class="adm-item">
        <div class="adm-item-main">
          <span class="adm-item-title mono">{{ k.keyPrefix }}…</span>
          <span class="adm-item-meta">{{ t("experimentApiKeys.created_created_last_used_used", { created: formatDate(k.createdAt), used: formatDate(k.lastUsedAt) }) }}</span>
        </div>
        <Button variant="danger" v-if="canManage" @click="revoke(k.id)">{{ t("experimentApiKeys.revoke") }}</Button>
      </li>
    </ul>
    <p v-else-if="!loading" class="adm-empty">
      {{ t("experimentApiKeys.no_api_keys_yet") }}
      <template v-if="canManage">{{ t("experimentApiKeys.create_one_then_follow_the") + " " }}<em>{{ t("experimentApiKeys.connect") }}</em>{{ " " + t("experimentApiKeys.tab_to_configure_your_agent") }}</template>
      <template v-else>{{ t("experimentApiKeys.an_experiment_admin_needs_to_create") }}</template>
    </p>

    <p v-if="!canManage && keys.length" class="adm-hint">{{ t("experimentApiKeys.you_can_only_see_and_revoke") }}</p>
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
