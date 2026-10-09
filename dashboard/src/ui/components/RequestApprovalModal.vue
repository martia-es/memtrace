<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuasar } from "quasar";
import type { PromptApprovalsResponse } from "@contract";
import { describeApiError } from "@/application/describe-api-error";
import { describeRule, profileLabel, requestTitle, ruleFor } from "@/domain/approvals";
import { useIdentityApi } from "../composables/useIdentityApi";
import { useAsync } from "../composables/useAsync";
import { usePromptApi } from "../composables/usePromptApi";
import Modal from "./Modal.vue";
import TextInput from "./TextInput.vue";
import Button from "./Button.vue";
import Checkbox from "./Checkbox.vue";

/**
 * Pedir aprobación (ADR-076) para publicar un borrador o apuntar un entorno a una versión. Enseña qué exige la regla de
 * hoy, deja escribir una nota para quien revisa y añadir aprobadores a esta solicitud además de los de la regla.
 */
const props = defineProps<{ promptId: string; action: "publish" | "promote"; version: number; tag?: string }>();
const emit = defineEmits<{ close: []; opened: [] }>();

const api = usePromptApi();
const identity = useIdentityApi();
const $q = useQuasar();

const info = useAsync<PromptApprovalsResponse>((signal) => api.getApprovals(props.promptId, signal));
const me = useAsync((signal) => identity.getMe(signal));
void info.run();
void me.run();

const names = computed(() => Object.fromEntries((info.data.value?.approvers ?? []).map((p) => [p.userId, p.name])));
const rule = computed(() => ruleFor(info.data.value?.rules ?? [], props.action, props.tag ?? ""));
// quien pide no puede aprobar su propia solicitud: no se ofrece como aprobador
const candidates = computed(() => (info.data.value?.approvers ?? []).filter((p) => p.userId !== me.data.value?.id && !(rule.value?.approvers ?? []).includes(p.userId)));

const note = ref("");
const extra = ref<string[]>([]);
const sending = ref(false);
const problem = ref<string | null>(null);

function toggle(userId: string, on: boolean) {
  extra.value = on ? [...extra.value, userId] : extra.value.filter((id) => id !== userId);
}

async function send() {
  sending.value = true;
  problem.value = null;
  try {
    await api.openApproval(props.promptId, { action: props.action, version: props.version, ...(props.tag ? { tag: props.tag } : {}), note: note.value.trim(), extraApprovers: extra.value });
    $q.notify({ message: "Request sent. The reviewers can see it now", color: "positive", timeout: 3000 });
    emit("opened");
    emit("close");
  } catch (error) {
    problem.value = describeApiError(error as Error);
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <Modal :title="`Ask for approval: ${requestTitle({ action, version, tag: tag ?? '' })}`" medium @close="emit('close')">
    <div class="ask" data-testid="request-modal">
      <p v-if="info.loading.value && !info.data.value" class="muted">Reading the rule…</p>
      <template v-else>
        <section class="rule">
          <span class="eyebrow">WHAT THE RULE ASKS FOR</span>
          <p data-testid="request-rule">{{ describeRule(rule, names) }}</p>
          <p class="muted">Your own approval never counts: someone else has to look at it.</p>
        </section>

        <label class="field">
          <span>Note for the reviewers (optional)</span>
          <TextInput v-model="note" multiline :rows="3" placeholder="What changes and why" data-testid="request-note" />
        </label>

        <fieldset v-if="candidates.length > 0" class="people">
          <legend>Also ask these people <span class="muted">(each one will have to approve)</span></legend>
          <Checkbox v-for="p in candidates" :key="p.userId" class="person" :checked="extra.includes(p.userId)" :data-testid="`extra-${p.userId}`" @change="toggle(p.userId, ($event.target as HTMLInputElement).checked)"> <span>{{ p.name }}</span>
            <span class="muted">{{ p.roles.map(profileLabel).join(", ") }}</span></Checkbox>
        </fieldset>

        <p v-if="problem" class="problem" role="alert" data-testid="request-error">{{ problem }}</p>
      </template>
      <div class="actions">
        <Button @click="emit('close')">Cancel</Button>
        <Button variant="primary" :disabled="sending || (info.loading.value && !info.data.value)" data-testid="request-send" @click="send">{{ sending ? "Sending…" : "Send request" }}</Button>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.ask { display: flex; flex-direction: column; gap: 14px; min-width: min(520px, 80vw); }
.eyebrow { font-size: 11px; letter-spacing: 0.06em; color: var(--mt-muted); }
.rule { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 1px solid var(--mt-line); font-size: 14px; }
.rule p { margin: 0; }
.muted { color: var(--mt-muted); font-size: 12px; }
.field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.people { border: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
legend { font-size: 13px; font-weight: 700; margin-bottom: 4px; }
.person { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.problem { margin: 0; padding: 10px 12px; font-size: 13px; color: var(--mt-err-ink); background: var(--mt-err-bg); border-radius: var(--mt-radius-sm); }
.actions { display: flex; justify-content: flex-end; gap: 10px; }
.ghost { height: 36px; padding: 0 16px; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-lg); background: transparent; color: var(--mt-ink); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }

</style>
