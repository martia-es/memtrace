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
const ORDER: RetentionLevelDto[] = ["unclassified", "high", "limited", "minimal"];
// sin clasificar primero: es lo que pide atención
const agents = computed(() => [...(policy.value?.agents ?? [])].sort((a, b) => ORDER.indexOf(levelOf({ level: a.level })) - ORDER.indexOf(levelOf({ level: b.level })) || a.name.localeCompare(b.name)));
const unclassified = computed(() => agentsOf("unclassified"));
const keptDays = (a: Agent) => (policy.value ? daysOfLevel(policy.value, levelOf({ level: a.level })) : 0);
const agentsOf = (level: RetentionLevelDto): Agent[] => (policy.value?.agents ?? []).filter((a) => levelOf({ level: a.level }) === level);
const invalid = (level: RetentionLevelDto, min: number) => retentionFieldError(drafts.value[level] ?? null, min, policy.value?.maxDays ?? 365) !== null;
const minOf = (level: RetentionLevelDto) => levels.value.find((l) => l.level === level)?.minDays ?? 0;
const dirty = (level: RetentionLevelDto) => !!policy.value && drafts.value[level] !== daysOfLevel(policy.value, level);

function note(level: RetentionLevelDto): string {
  if (dirty(level) && !invalid(level, minOf(level))) return t("riskPolicy.was_edited", { days: policy.value ? daysOfLevel(policy.value, level) : 0 });
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
    <div class="adm-card panel">
      <div class="top">
        <div class="intro">
          <h3 class="adm-section-title">{{ t("riskPolicy.risk_retention") }}</h3>
          <p class="lead">{{ t("riskPolicy.intro") }}</p>
        </div>
        <span class="kept-chip"><i aria-hidden="true" />{{ t("riskPolicy.never_deleted") }}</span>
      </div>

      <p v-if="!canEditRetention" class="adm-hint" data-testid="retention-readonly">{{ t("riskPolicy.you_can_see_the_periods_but_changing") }}</p>
      <p v-if="loading && !policy" class="adm-hint">{{ t("riskPolicy.loading") }}</p>

      <div v-if="unclassified.length > 0" class="attention" data-testid="unclassified-banner">
        <i aria-hidden="true" />
        <span>{{ tp("riskPolicy.unclassified_banner", unclassified.length, { days: policy ? daysOfLevel(policy, "unclassified") : 180 }) }}</span>
        <Button v-if="canClassify" size="sm" variant="primary" data-testid="classify-first" @click="classifying = unclassified[0] ?? null">{{ t("riskPolicy.classify_now") }}</Button>
      </div>

      <section class="group">
        <h4 class="label">{{ t("riskPolicy.how_long_traces_are_kept") }}</h4>
        <div class="tiles">
          <div v-for="l in levels" :key="l.level" class="tile" :data-testid="`level-${l.level}`">
            <div class="tile-head">
              <Pill :tone="RISK_TONE[l.level]">{{ RISK_LABEL[l.level] }}</Pill>
              <span class="count">{{ tp("riskPolicy.agents_count", agentsOf(l.level).length) }}</span>
            </div>
            <p class="desc">{{ RISK_DESCRIPTION[l.level] }}</p>
            <div class="keep">
              <input
                v-model.number="drafts[l.level]"
                type="number"
                :min="l.minDays"
                :max="policy?.maxDays"
                step="1"
                :disabled="!canEditRetention"
                :class="{ bad: invalid(l.level, l.minDays), edited: dirty(l.level) }"
                :aria-label="t('riskPolicy.retention_of_level_in_days', { level: RISK_LABEL[l.level] })"
                @keyup.enter="save(l.level)"
              />
              <span class="unit">{{ t("riskPolicy.days") }}</span>
              <Button v-if="canEditRetention && dirty(l.level)" variant="primary" size="sm" :disabled="invalid(l.level, l.minDays) || saving === l.level || confirming?.level === l.level" :data-testid="`save-${l.level}`" @click="save(l.level)">{{ t("riskPolicy.save") }}</Button>
            </div>
            <span class="note" :class="{ bad: invalid(l.level, l.minDays), edited: dirty(l.level) && !invalid(l.level, l.minDays) }">{{ invalid(l.level, l.minDays) ? t("riskPolicy.choose_a_whole_number_from_min", { min: l.minDays, max: policy?.maxDays ?? 365 }) : note(l.level) }}</span>
          </div>
        </div>
        <p class="adm-hint">{{ t("riskPolicy.floor", { floor: policy?.aiActFloorDays ?? 180, max: policy?.maxDays ?? 365 }) }}</p>

        <div v-if="confirming" class="confirm" role="alert" data-testid="confirm-lowering">
          <p>
            <b>{{ tp("riskPolicy.lowering", confirming.agents, { level: RISK_LABEL[confirming.level], from: confirming.previousDays, to: confirming.days }) }}</b>
            {{ " " + spansText(confirming) }}
          </p>
          <Button size="sm" @click="cancelLowering">{{ t("riskPolicy.cancel") }}</Button>
          <Button size="sm" variant="danger" :loading="saving === confirming.level" data-testid="confirm-lower" @click="confirmLowering">{{ t("riskPolicy.lower_and_delete") }}</Button>
        </div>
      </section>

      <section class="group">
        <h4 class="label">{{ t("riskPolicy.agents") }}</h4>
        <div class="row head" aria-hidden="true">
          <span>{{ t("riskPolicy.col_name") }}</span><span>{{ t("riskPolicy.col_purpose") }}</span><span>{{ t("riskPolicy.col_level") }}</span><span>{{ t("riskPolicy.col_kept") }}</span><span>{{ t("riskPolicy.col_classified_by") }}</span><span />
        </div>
        <div v-for="a in agents" :key="a.experimentId" class="row agent" :class="{ pending: a.level === null }" :data-testid="`agent-${a.name}`">
          <span class="name">{{ a.name }}</span>
          <span class="purpose" :title="a.intendedPurpose">{{ a.intendedPurpose || t("riskPolicy.not_declared_yet") }}</span>
          <span><Pill :tone="RISK_TONE[levelOf({ level: a.level })]">{{ RISK_LABEL[levelOf({ level: a.level })] }}</Pill></span>
          <span class="kept">{{ t("riskPolicy.days_value", { days: keptDays(a) }) }}</span>
          <span class="who">{{ a.classifiedBy && a.classifiedAt ? `${a.classifiedBy.name ?? a.classifiedBy.email} · ${formatDate(a.classifiedAt)}` : t("riskPolicy.never_classified") }}</span>
          <span class="act"><Button v-if="canClassify" size="sm" :variant="a.level === null ? 'primary' : 'link'" :data-testid="`classify-${a.name}`" @click="classifying = a">{{ a.level === null ? t("riskPolicy.classify") : t("riskPolicy.change_level") }}</Button></span>
        </div>
      </section>
    </div>

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
.panel { display: flex; flex-direction: column; gap: 20px; }
.top { display: flex; align-items: flex-start; gap: 24px; }
.intro { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.lead { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.45; color: var(--mt-muted); }
.kept-chip { flex: none; display: inline-flex; align-items: center; gap: 8px; height: 32px; padding: 0 12px; border-radius: 16px; background: var(--mt-soft); color: var(--mt-muted); font-size: 12.5px; font-weight: 700; }
.kept-chip i { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.attention { display: flex; align-items: center; gap: 14px; padding: 12px 16px; border-radius: var(--mt-radius); background: var(--mt-warn-bg); color: var(--mt-warn-ink); font-weight: 600; }
.attention i { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--mt-warn); }
.attention span { flex: 1; }
.group { display: flex; flex-direction: column; gap: 10px; }
.label { margin: 0; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--mt-faint); }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
.tile { display: flex; flex-direction: column; gap: 10px; padding: 16px 18px; border-radius: 10px; background: var(--mt-soft); }
.tile-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.count { font-size: 12px; font-weight: 700; color: var(--mt-muted); }
.desc { margin: 0; min-height: 34px; font-size: 12px; line-height: 1.4; color: var(--mt-muted); }
.keep { display: flex; align-items: center; gap: 8px; }
.keep input { width: 84px; height: 40px; box-sizing: border-box; padding: 0 12px; border: 1px solid var(--mt-border); border-radius: var(--mt-radius-sm); background: var(--mt-card); color: var(--mt-ink); font-family: var(--mt-mono); font-size: 20px; }
.keep input.edited { background: var(--mt-warn-bg); border-color: var(--mt-warn); }
.keep input.bad { border-color: var(--mt-err); }
.unit { font-weight: 700; color: var(--mt-muted); }
.keep :deep(.mt-btn) { margin-left: auto; }
.note { min-height: 31px; font-size: 11.5px; line-height: 1.35; color: var(--mt-faint); }
.note.bad { color: var(--mt-err-ink); }
.note.edited { color: var(--mt-warn-ink); }
.confirm { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: var(--mt-radius); background: var(--mt-warn-bg); color: var(--mt-warn-ink); }
.confirm p { flex: 1; margin: 0; line-height: 1.45; }
.row { display: grid; grid-template-columns: 200px minmax(0, 1fr) 130px 100px 170px 110px; gap: 14px; align-items: center; padding: 0 12px; min-height: 46px; border-radius: var(--mt-radius); }
.row.head { min-height: 30px; font-size: 11px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--mt-faint); }
.row.pending { background: var(--mt-warn-bg); }
.name { font-weight: 800; }
.purpose { font-size: 12px; color: var(--mt-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kept { font-family: var(--mt-mono); font-size: 12.5px; }
.who { font-size: 12px; color: var(--mt-muted); }
.act { display: flex; justify-content: flex-end; }
@media (max-width: 1000px) { .row { grid-template-columns: 1fr auto; } .row.head, .purpose, .who { display: none; } }
</style>
