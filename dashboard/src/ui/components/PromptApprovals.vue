<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuasar } from "quasar";
import type { ApprovalRequestDto } from "@contract";
import { describeApiError } from "@/application/describe-api-error";
import { REQUEST_STATUS, canDecideNow, daysLeft, describeRule, profileLabel, progressLines, requestTitle, steps, waitingOn } from "@/domain/approvals";
import { formatDateTime } from "@/domain/format";
import { useApprovalInbox } from "../composables/useApprovalInbox";
import { useAsync } from "../composables/useAsync";
import { useIdentityApi } from "../composables/useIdentityApi";
import { usePromptApi } from "../composables/usePromptApi";
import StatusChip from "./StatusChip.vue";
import TextInput from "./TextInput.vue";

/**
 * Pestaña Approvals de un prompt (ADR-076): qué exige hoy cada paso y las solicitudes abiertas y pasadas. Quien puede
 * decidir aprueba o rechaza aquí; quien pidió puede cancelar, añadir aprobadores o reintentar si el gate frenó la ejecución.
 */
const props = defineProps<{ promptId: string; environments: string[] }>();
const emit = defineEmits<{ changed: [] }>();

const api = usePromptApi();
const identity = useIdentityApi();
const $q = useQuasar();
const inbox = useApprovalInbox();

const info = useAsync((signal) => api.getApprovals(props.promptId, signal));
const me = useAsync((signal) => identity.getMe(signal));
void info.run();
void me.run();

const userId = computed(() => me.data.value?.id ?? null);
const requests = computed(() => info.data.value?.requests ?? []);
const rules = computed(() => info.data.value?.rules ?? []);
const directory = computed(() => info.data.value?.approvers ?? []);
const names = computed(() => Object.fromEntries(directory.value.map((p) => [p.userId, p.name])));
const ruleSteps = computed(() => steps(props.environments).map((s) => ({ ...s, rule: rules.value.find((r) => r.action === s.action && r.stage === s.stage) ?? null })));
const anyRule = computed(() => rules.value.length > 0);
const now = new Date();

const comments = ref<Record<string, string>>({});
const adding = ref<Record<string, string>>({});
const busy = ref<string | null>(null);

async function act(request: ApprovalRequestDto, run: () => Promise<unknown>, done: string) {
  busy.value = request.id;
  try {
    await run();
    await info.run();
    void inbox.refresh();
    emit("changed");
    $q.notify({ message: done, color: "positive", timeout: 3000 });
  } catch (error) {
    $q.notify({ message: describeApiError(error as Error), color: "negative", timeout: 5000 });
  } finally {
    busy.value = null;
  }
}

const decide = (r: ApprovalRequestDto, decision: "approve" | "reject") =>
  act(r, () => api.decideApproval(r.id, decision, (comments.value[r.id] ?? "").trim()), decision === "approve" ? "Your approval is recorded" : "Request rejected");
const cancel = (r: ApprovalRequestDto) => act(r, () => api.cancelApproval(r.id), "Request cancelled");
const retry = (r: ApprovalRequestDto) => act(r, () => api.executeApproval(r.id), "Done");
const addApprover = (r: ApprovalRequestDto) => act(r, () => api.addApprover(r.id, adding.value[r.id]!), "Approver added");

const isMine = (r: ApprovalRequestDto) => userId.value !== null && r.requestedBy === userId.value;
const live = (r: ApprovalRequestDto) => r.status === "pending" || r.status === "approved";
const addable = (r: ApprovalRequestDto) => directory.value.filter((p) => p.userId !== r.requestedBy && !r.extraApprovers.includes(p.userId) && !(r.rule?.approvers ?? []).includes(p.userId));
const who = (r: ApprovalRequestDto, id: string | null) => (id ? (r.people[id] ?? names.value[id] ?? "Someone") : "Someone");
</script>

<template>
  <div class="approvals" data-testid="approvals-tab">
    <section class="rules" data-testid="approval-summary">
      <h3>What needs approval</h3>
      <p v-if="!anyRule" class="muted" data-testid="no-rules">Nothing: changes to this prompt happen without a review. An organization admin can turn approvals on in Admin → organization → Approvals.</p>
      <ul v-else>
        <li v-for="s in ruleSteps" :key="s.action + s.stage" :data-testid="`summary-${s.action}-${s.stage || 'publish'}`">
          <b>{{ s.label }}</b>
          <span>{{ describeRule(s.rule, names) }}</span>
        </li>
      </ul>
    </section>

    <section>
      <h3>Requests</h3>
      <p v-if="info.loading.value && !info.data.value" class="muted">Loading…</p>
      <p v-else-if="requests.length === 0" class="muted" data-testid="no-requests">No requests yet.</p>
      <ul v-else class="list">
        <li v-for="r in requests" :key="r.id" class="card" :data-testid="`request-${r.id}`">
          <header>
            <b data-testid="request-title">{{ requestTitle(r) }}</b>
            <StatusChip :tone="REQUEST_STATUS[r.status].tone" :label="REQUEST_STATUS[r.status].label" />
            <span class="muted">by {{ who(r, r.requestedBy) }} · {{ formatDateTime(r.createdAt) }}</span>
            <span v-if="live(r)" class="muted">· {{ daysLeft(r, now) }} day(s) left</span>
          </header>
          <p v-if="r.note" class="note">“{{ r.note }}”</p>

          <ul v-if="live(r)" class="progress" data-testid="request-progress">
            <li v-for="p in progressLines(r)" :key="p.label" :class="{ done: p.done }">{{ p.label }} {{ p.have }}/{{ p.need }}</li>
            <li v-for="name in waitingOn(r)" :key="name" class="wait">Waiting for {{ name }}</li>
          </ul>
          <p v-if="r.status === 'approved' && r.executionError" class="problem" data-testid="request-exec-error">Approved, but it could not be carried out yet: {{ r.executionError }}</p>

          <ul v-if="r.decisions.length" class="decisions">
            <li v-for="d in r.decisions" :key="d.userId">
              <b>{{ who(r, d.userId) }}</b> {{ d.decision === "approve" ? "approved" : "rejected" }}<template v-if="d.comment">: “{{ d.comment }}”</template>
            </li>
          </ul>

          <div v-if="canDecideNow(r, userId)" class="decide" data-testid="decide">
            <TextInput v-model="comments[r.id]" placeholder="Comment (optional)" :data-testid="`comment-${r.id}`" />
            <button type="button" class="primary-btn" :disabled="busy === r.id" data-testid="approve" @click="decide(r, 'approve')">Approve</button>
            <button type="button" class="ghost" :disabled="busy === r.id" data-testid="reject" @click="decide(r, 'reject')">Reject</button>
          </div>

          <div v-if="live(r) && (isMine(r) || canDecideNow(r, userId))" class="more">
            <template v-if="r.status === 'pending' && addable(r).length > 0">
              <select v-model="adding[r.id]" :aria-label="'Add an approver'" :data-testid="`add-select-${r.id}`">
                <option :value="undefined">Add an approver…</option>
                <option v-for="p in addable(r)" :key="p.userId" :value="p.userId">{{ p.name }} · {{ p.roles.map(profileLabel).join(", ") }}</option>
              </select>
              <button type="button" class="ghost" :disabled="!adding[r.id] || busy === r.id" data-testid="add-approver" @click="addApprover(r)">Add</button>
            </template>
            <button v-if="r.status === 'approved' && isMine(r)" type="button" class="ghost" :disabled="busy === r.id" data-testid="retry" @click="retry(r)">Try again</button>
            <button v-if="isMine(r)" type="button" class="ghost" :disabled="busy === r.id" data-testid="cancel" @click="cancel(r)">Cancel request</button>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.approvals { display: flex; flex-direction: column; gap: 20px; }
h3 { margin: 0 0 8px; font-size: 14px; }
.muted { color: var(--mt-muted); font-size: 12px; margin: 0; }
.rules ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.rules li { display: flex; gap: 10px; }
.rules li b { min-width: 130px; }
.list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
.card { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); font-size: 13px; }
header { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.note { margin: 0; color: var(--mt-ink); }
.progress, .decisions { margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 6px 14px; }
.progress li { padding: 2px 8px; background: var(--mt-soft); border-radius: var(--mt-radius-xs); font-weight: 600; }
.progress li.done { background: var(--mt-ok-bg); color: var(--mt-ok-ink); }
.progress li.wait { background: var(--mt-warn-bg, var(--mt-soft)); }
.decisions { flex-direction: column; gap: 2px; }
.problem { margin: 0; padding: 8px 10px; color: var(--mt-err-ink); background: var(--mt-err-bg); border-radius: var(--mt-radius-sm); }
.decide, .more { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.decide > :first-child { flex: 1; min-width: 200px; }
select { height: 32px; padding: 0 8px; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-xs); background: transparent; color: var(--mt-ink); font: inherit; }
.ghost { height: 32px; padding: 0 14px; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-lg); background: transparent; color: var(--mt-ink); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.primary-btn { height: 32px; padding: 0 16px; border: none; border-radius: var(--mt-radius-lg); background: var(--mt-accent); color: var(--mt-accent-ink); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
