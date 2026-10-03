<script setup lang="ts">
import type { RunListItemDto } from "@contract";
import { computed } from "vue";
import { useQuasar } from "quasar";
import { formatDateTime } from "@/domain/format";
import { aggregateTone, aggregateValueLabel, judgeChanged } from "@/domain/evaluation";
import { buildOfflineSeries, judgeChangeNotices, offlineEvalChartOption, offlineRunLabel } from "../offline-eval-chart-option";
import EChart from "./EChart.vue";

const props = defineProps<{ runs: RunListItemDto[] }>();
const emit = defineEmits<{ "open-run": [run: RunListItemDto] }>();

const $q = useQuasar();

const selected = computed(() => props.runs);
const passRateSeries = computed(() => buildOfflineSeries(selected.value, "passRate"));
const averageSeries = computed(() => buildOfflineSeries(selected.value, "average"));
const passRateOption = computed(() => offlineEvalChartOption(selected.value, passRateSeries.value, "passRate", $q.dark.isActive));
const averageOption = computed(() => offlineEvalChartOption(selected.value, averageSeries.value, "average", $q.dark.isActive));

/** Último run de cada evaluador frente al anterior: la lectura rápida de "¿he empeorado?". */
const latest = computed(() => selected.value[selected.value.length - 1] ?? null);
const previous = computed(() => selected.value[selected.value.length - 2] ?? null);

const judgeNotices = computed(() => judgeChangeNotices(selected.value));

/** El último run usó otro juez que el anterior para este evaluador: la diferencia no mide al agente. */
function judgeChangedSinceLast(name: string): boolean {
  return judgeChanged(previous.value?.aggregates.find((x) => x.name === name), latest.value?.aggregates.find((x) => x.name === name));
}

function delta(name: string): string | null {
  const a = latest.value?.aggregates.find((x) => x.name === name);
  const b = previous.value?.aggregates.find((x) => x.name === name);
  if (!a || !b) return null;
  const [x, y, pct] = a.passRate !== null && b.passRate !== null ? [a.passRate, b.passRate, true] : [a.average, b.average, false];
  if (x === null || y === null) return null;
  const d = x - y;
  const sign = d > 0 ? "+" : "";
  return pct ? `${sign}${(d * 100).toFixed(1)} pp` : `${sign}${d.toFixed(2)}`;
}

</script>

<template>
  <div class="offline">
    <template v-if="selected.length">
      <section v-if="latest" class="latest">
        <h3>Latest run · {{ offlineRunLabel(latest) }}</h3>
        <div class="kpis">
          <div v-for="a in latest.aggregates.filter((x) => x.passRate !== null || x.average !== null)" :key="a.name" class="kpi" :class="`tone-${aggregateTone(a)}`">
            <span class="kpi-name">{{ a.name }}</span>
            <span class="kpi-value">{{ aggregateValueLabel(a) }}</span>
            <span v-if="judgeChangedSinceLast(a.name)" class="kpi-delta judge-changed" title="The judge model or rubric differs from the previous run, so the change is not comparable">⚠ judge changed</span>
            <span v-else-if="delta(a.name)" class="kpi-delta">{{ delta(a.name) }} vs. previous</span>
          </div>
        </div>
      </section>

      <section v-if="judgeNotices.length" class="judge-notice" role="alert">
        <strong>The judge changed between runs</strong>
        <p>Pass rates before and after are not directly comparable. Marked with a diamond in the charts.</p>
        <ul>
          <li v-for="n in judgeNotices" :key="`${n.evaluator}-${n.toRun}`">
            <code>{{ n.evaluator }}</code>: {{ n.fromRun }} → {{ n.toRun }} ({{ n.from }} → {{ n.to }})
          </li>
        </ul>
      </section>

      <section v-if="passRateSeries.length" class="chart-card">
        <h3>Pass rate per evaluator</h3>
        <EChart :option="passRateOption" label="Pass rate per evaluator across offline runs" height="300px" />
      </section>

      <section v-if="averageSeries.length" class="chart-card">
        <h3>Average per evaluator</h3>
        <EChart :option="averageOption" label="Average score per evaluator across offline runs" height="300px" />
      </section>

      <section class="chart-card">
        <h3>Runs</h3>
        <table class="runs-table">
          <thead>
            <tr><th>Run</th><th>Dataset</th><th>Version</th><th>Items</th><th>Date</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in [...selected].reverse()" :key="r.id" @click="emit('open-run', r)">
              <td>{{ r.name }}</td>
              <td>{{ r.datasetName }}</td>
              <td>v{{ r.versionMajor }}.{{ r.versionMinor }}</td>
              <td>{{ r.itemCount }}</td>
              <td>{{ formatDateTime(r.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<style scoped>
.offline { display: flex; flex-direction: column; gap: 16px; }
.hint { margin: 0; font-size: 12px; opacity: 0.7; }
h3 { margin: 0 0 10px; font-size: 13px; font-weight: 600; }
.chart-card, .latest { border: 1px solid var(--mt-border, rgba(128, 128, 128, 0.25)); border-radius: 8px; padding: 14px 16px; }
.kpis { display: flex; flex-wrap: wrap; gap: 12px; }
.kpi { display: flex; flex-direction: column; min-width: 140px; padding: 8px 12px; border-radius: 6px; border: 1px solid var(--mt-border, rgba(128, 128, 128, 0.25)); }
.kpi-name { font-size: 11px; opacity: 0.7; }
.kpi-value { font-size: 20px; font-weight: 600; }
.kpi-delta { font-size: 11px; opacity: 0.7; }
.judge-changed { color: var(--q-negative, #b3261e); opacity: 1; }
.judge-notice { border: 1px solid var(--q-negative, #b3261e); border-radius: 8px; padding: 10px 14px; font-size: 12px; }
.judge-notice p { margin: 4px 0; }
.judge-notice ul { margin: 4px 0 0; padding-left: 18px; }
.tone-negative .kpi-value { color: var(--q-negative, #b3261e); }
.runs-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.runs-table th, .runs-table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--mt-border, rgba(128, 128, 128, 0.2)); }
.runs-table tbody tr { cursor: pointer; }
.runs-table tbody tr:hover { background: rgba(128, 128, 128, 0.08); }
</style>
