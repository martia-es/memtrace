<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { formatDateTime } from "@/domain/format";
import type { ChartKind } from "@/domain/custom-chart-vocabulary";
import type { MetricReportDto, MetricReportSummaryDto } from "@/application/identity-api";
import { useIdentityApi } from "../composables/useIdentityApi";
import Spinner from "./Spinner.vue";
import Card from "./Card.vue";

const props = defineProps<{ experimentId: string; report: MetricReportSummaryDto }>();

const identityApi = useIdentityApi();
const detail = ref<MetricReportDto | null>(null);
const loading = ref(true);

onMounted(async () => {
  try {
    detail.value = await identityApi.getMetricReport(props.experimentId, props.report.id);
  } catch {
    detail.value = null;
  } finally {
    loading.value = false;
  }
});

const GRID_COLS = 12;
const charts = computed(() => detail.value?.charts ?? []);
const rows = computed(() => Math.max(1, ...charts.value.map((c) => c.y + c.h)));

/** Posición en % del lienzo: la maqueta respeta el layout real del informe. */
function boxStyle(c: { x: number; y: number; w: number; h: number }) {
  return {
    left: `${(c.x / GRID_COLS) * 100}%`,
    top: `${(c.y / rows.value) * 100}%`,
    width: `${(c.w / GRID_COLS) * 100}%`,
    height: `${(c.h / rows.value) * 100}%`,
  };
}

const BARS = [45, 80, 60, 95, 55];
const LINE = "0,70 20,50 40,60 60,25 80,40 100,10";
const AREA = "0,100 0,70 20,50 40,60 60,25 80,40 100,10 100,100";

function kind(c: { definition: { chartType: ChartKind } }): ChartKind {
  return c.definition.chartType;
}
</script>

<template>
  <Card as="router-link" padding="none" block :to="{ name: 'overview-report', params: { experimentId, reportId: report.id } }" class="report-card" data-testid="report-link">
    <div class="preview" :class="{ empty: !loading && !charts.length }">
      <Spinner v-if="loading" size="sm" />
      <span v-else-if="!charts.length" class="preview-empty">No charts yet</span>
      <div v-for="c in charts" v-else :key="c.customMetricId" class="mini" :style="boxStyle(c)">
        <div v-if="kind(c) === 'bar'" class="mini-bars">
          <i v-for="(h, i) in BARS" :key="i" :style="{ height: `${h}%` }" />
        </div>
        <svg v-else-if="kind(c) === 'line' || kind(c) === 'area'" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon v-if="kind(c) === 'area'" :points="AREA" class="fill" />
          <polyline :points="LINE" class="stroke" />
        </svg>
        <div v-else-if="kind(c) === 'pie'" class="mini-pie" />
        <div v-else-if="kind(c) === 'number'" class="mini-number">42</div>
        <div v-else class="mini-table"><i /><i /><i /></div>
      </div>
    </div>
    <div class="info">
      <div class="name">{{ report.name }}</div>
      <div class="meta">
        <span>{{ loading ? "…" : `${charts.length} ${charts.length === 1 ? "chart" : "charts"}` }}</span>
        <span>Updated {{ formatDateTime(report.updatedAt) }}</span>
      </div>
    </div>
  </Card>
</template>

<style scoped>
.report-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--mt-ink);
  text-decoration: none;
  transition: border-color 0.15s, transform 0.15s;
}

.report-card:hover {
  border-color: var(--mt-accent);
  transform: translateY(-1px);
}

.preview {
  position: relative;
  height: 150px;
  margin: 12px 12px 0;
  border-radius: 6px;
  background: var(--mt-bg, rgba(127, 127, 127, 0.08));
  border: 1px solid var(--mt-border, rgba(127, 127, 127, 0.2));
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-empty {
  font-size: 12px;
  color: var(--mt-muted);
}

.mini {
  position: absolute;
  box-sizing: border-box;
  padding: 4px;
  border-radius: 4px;
  border: 1px solid var(--mt-border, rgba(127, 127, 127, 0.25));
  background: var(--mt-surface, rgba(127, 127, 127, 0.06));
  color: var(--mt-accent);
  overflow: hidden;
}

.mini svg {
  width: 100%;
  height: 100%;
}

.mini .stroke {
  fill: none;
  stroke: currentColor;
  stroke-width: 3;
  vector-effect: non-scaling-stroke;
}

.mini .fill {
  fill: currentColor;
  opacity: 0.2;
}

.mini-bars {
  display: flex;
  align-items: flex-end;
  gap: 8%;
  height: 100%;
}

.mini-bars i {
  flex: 1;
  background: currentColor;
  opacity: 0.75;
  border-radius: 1px;
}

.mini-pie {
  height: 100%;
  max-width: 100%;
  aspect-ratio: 1;
  margin: 0 auto;
  border-radius: 50%;
  background: conic-gradient(currentColor 0 45%, color-mix(in srgb, currentColor 55%, transparent) 45% 75%, color-mix(in srgb, currentColor 25%, transparent) 75% 100%);
}

.mini-number {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 18px;
  font-weight: 700;
}

.mini-table {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mini-table i {
  height: 4px;
  background: currentColor;
  opacity: 0.3;
  border-radius: 1px;
}

.info {
  padding: 12px 16px 14px;
}

.name {
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--mt-muted);
}
</style>
