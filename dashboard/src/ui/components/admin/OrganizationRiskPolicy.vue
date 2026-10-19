<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useQuasar } from "quasar";
import type { LevelChangePreviewDto, RetentionLevelDto, RetentionPolicyDto } from "@contract";
import type { OrganizationDto } from "@/application/identity-api";
import { RISK_DESCRIPTION, RISK_LABEL, RISK_TONE, daysOfLevel, levelOf, retentionFieldError } from "@/domain/risk";
import { useIdentityApi } from "../../composables/useIdentityApi";
import { formatDate, notifyErrorWith } from "../../composables/useAdminDirectory";
import Button from "../Button.vue";
import Pill from "../Pill.vue";
import ClassifyRiskModal from "../assistants/ClassifyRiskModal.vue";
import { t, tp } from "../../i18n";

/**
 * Riesgo y retención de la organización (ADR-102): el nivel de riesgo de cada agente y el plazo de retención de cada nivel,
 * juntos porque el plazo de un agente es el de su nivel. Es el único sitio donde se configura la retención de trazas. `high` y
 * sin clasificar no bajan del suelo del AI Act; bajar un plazo borra datos y se confirma viendo lo que se perdería.
 */
const props = defineProps<{ organization: OrganizationDto; canClassify: boolean; canEditRetention: boolean; canLower: boolean }>();

type Agent = RetentionPolicyDto["agents"][number];

const api = useIdentityApi();
const $q = useQuasar();

const policy = ref<RetentionPolicyDto | null>(null);
const loading = ref(true);
const drafts = ref<Record<string, number | null>>({});
const saving = ref<RetentionLevelDto | null>(null);
const confirming = ref<LevelChangePreviewDto | null>(null);
const classifying = ref<Agent | null>(null);

function adopt(next: RetentionPolicyDto) {
  policy.value = next;
  drafts.value = Object.fromEntries(next.levels.map((l) => [l.level, l.days]));
}

async function load() {
  loading.value = true;
  try {
    adopt(await api.getRiskPolicy(props.organization.id));
  } catch (error) {
    notifyErrorWith($q.notify, t("riskPolicy.could_not_load_the_risk_policy"), error);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const levels = computed(() => policy.value?.levels ?? []);
const agentsOf = (level: RetentionLevelDto): Agent[] => (policy.value?.agents ?? []).filter((a) => levelOf({ level: a.level }) === level);
const invalid = (level: RetentionLevelDto, min: number) => retentionFieldError(drafts.value[level] ?? null, min, policy.value?.maxDays ?? 365) !== null;
const dirty = (level: RetentionLevelDto) => !!policy.value && drafts.value[level] !== daysOfLevel(policy.value, level);

function note(level: RetentionLevelDto): string {
  if (level === "high") return t("riskPolicy.ai_act_floor_days_longer_is_allowed", { days: policy.value?.aiActFloorDays ?? 180 });
  if (level === "unclassified") return t("riskPolicy.same_floor_as_high_until_classified_so");
  return t("riskPolicy.no_legal_minimum");
}

async function apply(level: RetentionLevelDto, days: number, confirmLowering: boolean) {
  adopt(await api.setLevelRetention(props.organization.id, level, days, confirmLowering));
  confirming.value = null;
  $q.notify({ message: t("riskPolicy.retention_updated"), color: "positive", timeout: 2000 });
}

async function save(level: RetentionLevelDto) {
  if (!policy.value) return;
  const days = drafts.value[level];
  if (days === null || days === undefined) return;
  saving.value = level;
  try {
    if (days < daysOfLevel(policy.value, level)) {
      // bajar el plazo borra datos en la próxima purga: se enseña lo que se perdería y se pide confirmación
      const preview = await api.previewLevelRetention(props.organization.id, level, days);
      if (preview.agents > 0) {
        confirming.value = preview;
        return;
      }
    }
    await apply(level, days, false);
  } catch (error) {
    notifyErrorWith($q.notify, t("riskPolicy.could_not_update_retention"), error);
  } finally {
    saving.value = null;
  }
}

async function confirmLowering() {
  const preview = confirming.value;
  if (!preview) return;
  saving.value = preview.level;
  try {
    await apply(preview.level, preview.days, true);
  } catch (error) {
    notifyErrorWith($q.notify, t("riskPolicy.could_not_update_retention"), error);
  } finally {
    saving.value = null;
  }
}

function cancelLowering() {
  if (confirming.value && policy.value) drafts.value[confirming.value.level] = daysOfLevel(policy.value, confirming.value.level);
  confirming.value = null;
}

const spansText = (p: LevelChangePreviewDto) =>
  p.spans === null ? t("riskPolicy.traces_older_than_days_will_be_deleted", { days: p.days }) : t("riskPolicy.about_spans_older_than_days_will_be", { spans: p.spans.toLocaleString(), days: p.days });
</script>

<template>
  <div class="risk" data-testid="risk-policy">
    <div class="adm-card block">
      <h3 class="adm-section-title">{{ t("riskPolicy.risk_retention") }}</h3>
      <p class="adm-hint">{{ t("riskPolicy.the_risk_level_of_an_agent_decides") }}</p>
      <p class="adm-hint">{{ t("riskPolicy.floor", { floor: policy?.aiActFloorDays ?? 180, max: policy?.maxDays ?? 365 }) }}</p>
      <p v-if="!canEditRetention" class="adm-hint" data-testid="retention-readonly">{{ t("riskPolicy.you_can_see_the_periods_but_changing") }}</p>
    </div>

    <p v-if="loading && !policy" class="adm-hint">{{ t("riskPolicy.loading") }}</p>

    <section v-for="l in levels" :key="l.level" class="adm-card level" :data-testid="`level-${l.level}`">
      <header class="head">
        <Pill :tone="RISK_TONE[l.level]">{{ RISK_LABEL[l.level] }}</Pill>
        <span class="desc">{{ RISK_DESCRIPTION[l.level] }}</span>
        <span class="grow" />
        <label class="keep">
          <span>{{ t("riskPolicy.keep_traces") }}</span>
          <span class="inp">
            <input
              v-model.number="drafts[l.level]"
              type="number"
              :min="l.minDays"
              :max="policy?.maxDays"
              step="1"
              :disabled="!canEditRetention"
              :class="{ bad: invalid(l.level, l.minDays) }"
              :aria-label="t('riskPolicy.retention_of_level_in_days', { level: RISK_LABEL[l.level] })"
              @keyup.enter="save(l.level)"
            />
            <span class="unit">{{ t("riskPolicy.days") }}</span>
          </span>
        </label>
        <Button v-if="canEditRetention" variant="primary" size="sm" :disabled="!dirty(l.level) || invalid(l.level, l.minDays) || saving === l.level || confirming?.level === l.level" :data-testid="`save-${l.level}`" @click="save(l.level)">{{ t("riskPolicy.save") }}</Button>
        <span class="note" :class="{ bad: invalid(l.level, l.minDays) }">{{ invalid(l.level, l.minDays) ? t("riskPolicy.choose_a_whole_number_from_min", { min: l.minDays, max: policy?.maxDays ?? 365 }) : note(l.level) }}</span>
      </header>

      <div v-if="confirming?.level === l.level" class="confirm" role="alert" data-testid="confirm-lowering">
        <p>
          <b>{{ tp("riskPolicy.lowering", confirming.agents, { level: RISK_LABEL[l.level], from: confirming.previousDays, to: confirming.days }) }}</b>
          {{ " " + spansText(confirming) }}
        </p>
        <Button size="sm" @click="cancelLowering">{{ t("riskPolicy.cancel") }}</Button>
        <Button size="sm" variant="danger" :loading="saving === l.level" data-testid="confirm-lower" @click="confirmLowering">{{ t("riskPolicy.lower_and_delete") }}</Button>
      </div>

      <ul class="agents">
        <li v-if="agentsOf(l.level).length === 0" class="empty">{{ t("riskPolicy.no_agents_at_this_level") }}</li>
        <li v-for="a in agentsOf(l.level)" :key="a.experimentId" class="agent" :data-testid="`agent-${a.name}`">
          <span class="name">{{ a.name }}</span>
          <span class="purpose" :title="a.intendedPurpose">{{ a.intendedPurpose || t("riskPolicy.not_declared_yet") }}</span>
          <span class="who">{{ a.classifiedBy && a.classifiedAt ? `${a.classifiedBy.name ?? a.classifiedBy.email} · ${formatDate(a.classifiedAt)}` : t("riskPolicy.never_classified") }}</span>
          <Button v-if="canClassify" size="sm" :variant="a.level === null ? 'primary' : 'link'" :data-testid="`classify-${a.name}`" @click="classifying = a">{{ a.level === null ? t("riskPolicy.classify") : t("riskPolicy.change_level") }}</Button>
        </li>
      </ul>
    </section>

    <ClassifyRiskModal
      v-if="classifying && policy"
      :experiment-id="classifying.experimentId"
      :name="classifying.name"
      :level-days="Object.fromEntries(policy.levels.map((x) => [x.level, x.days]))"
      :can-lower="canLower"
      @close="classifying = null"
      @saved="classifying = null; load()"
    />
  </div>
</template>

<style scoped>
.risk { display: flex; flex-direction: column; gap: 12px; }
.block { display: flex; flex-direction: column; gap: 8px; }
.level { display: flex; flex-direction: column; gap: 0; padding: 0; overflow: hidden; }
.head { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 14px; padding: 10px 18px; background: var(--mt-soft); }
.desc { font-size: 12px; color: var(--mt-muted); }
.grow { flex: 1; }
.keep { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; color: var(--mt-muted); }
.inp { display: inline-flex; align-items: center; gap: 6px; }
.inp input { width: 76px; padding: 6px 9px; border: 1px solid var(--mt-border); border-radius: var(--mt-radius-sm); background: var(--mt-card); color: var(--mt-ink); font: inherit; font-family: var(--mt-mono); }
.inp input.bad { border-color: var(--mt-err); }
.unit { color: var(--mt-muted); font-size: 13px; }
.note { flex-basis: 100%; font-size: 11.5px; color: var(--mt-faint); }
.note.bad { color: var(--mt-err-ink); }
.confirm { display: flex; align-items: center; gap: 12px; margin: 10px 18px; padding: 10px 14px; border-radius: var(--mt-radius); background: var(--mt-warn-bg); border: 1px solid var(--mt-warn); color: var(--mt-warn-ink); }
.confirm p { flex: 1; margin: 0; line-height: 1.45; }
.agents { margin: 0; padding: 0; list-style: none; }
.agent, .empty { display: grid; grid-template-columns: 200px minmax(0, 1fr) 200px 120px; gap: 12px; align-items: center; padding: 0 18px; min-height: 38px; border-top: 1px solid var(--mt-line); }
.empty { display: block; line-height: 38px; font-size: 12px; color: var(--mt-faint); }
.name { font-weight: 700; }
.purpose { font-size: 12px; color: var(--mt-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.who { font-size: 12px; color: var(--mt-faint); }
.agent > :last-child { justify-self: end; }
</style>
