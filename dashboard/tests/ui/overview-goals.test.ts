import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { computed, defineComponent, h } from "vue";
import { describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import type { AlertRuleDto, BudgetViewDto } from "@contract";
import { CURRENT_EXPERIMENT, IDENTITY_API, TRACE_API } from "@/dependency-container";
import { EMPTY_THEME } from "@/application/identity-api";
import MetricsPage from "@/ui/pages/MetricsPage.vue";
import { permissionsOf } from "../permissions";
import { FakeIdentityApi, FakeTraceApi } from "../fakes";

// Objetivos en el Overview (M1): errores, latencia y coste con semáforo, y los objetivos de partida en la primera visita
vi.mock("@/ui/components/EChart.vue", () => ({ default: { name: "EChart", template: "<div class=\"echart-stub\" />" } }));

const overview = {
  range: { from: "", to: "", bucketSeconds: 60 },
  totals: { traces: 57, spans: 900, conversations: 13, errorTraces: 4, errorRate: 0.07, inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 1.5 },
  latencyMs: { p50: 100, p95: 2700, p99: 9000 },
  timeseries: [], byModel: [], byTool: [], byTopic: [],
};
const rule = (over: Partial<AlertRuleDto>): AlertRuleDto => ({
  id: "r1", experimentId: "exp-1", name: "goal", metric: "error_rate", customMetricId: null, comparator: "above", threshold: 3, windowMinutes: 1440,
  minSamples: 10, reminderMinutes: null, recipients: [], enabled: true, createdAt: "", updatedAt: "", ...over,
});
const status = (state: "ok" | "firing", lastValue: number) => ({ state, since: "", lastValue, lastCheckedAt: null, lastNotifiedAt: null });
const budget: BudgetViewDto = { budget: { experimentId: "exp-1", monthlyUsd: 95, warnPercent: 80, recipients: [], enabled: true, updatedAt: "" }, month: "2026-10-01", spentUsd: 38.72, percent: 40.8, projectedUsd: 74 };

async function open(identity: FakeIdentityApi, role = "technical") {
  const trace = new FakeTraceApi();
  trace.overview = overview;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/e/:experimentId/overview", name: "overview", component: { template: "<div />" } },
      { path: "/e/:experimentId/alerts", name: "alerts", component: { template: "<div />" } },
      { path: "/e/:experimentId/conversations", name: "conversations", component: { template: "<div />" } },
      { path: "/annotation-queues", name: "annotation-queues", component: { template: "<div />" } },
    ],
  });
  await router.push("/e/exp-1/overview");
  await router.isReady();
  const Host = defineComponent({ setup: () => () => h(QLayout, () => h(QPageContainer, () => h(MetricsPage))) });
  const exp = { id: "exp-1", organizationId: "org-1", name: "Weather", serviceName: "weather", myRole: role, permissions: permissionsOf(role), organizationTheme: EMPTY_THEME };
  const wrapper = mount(Host, { global: { plugins: [[Quasar, { plugins: { Dark, Notify } }], router], provide: { [TRACE_API as symbol]: trace, [IDENTITY_API as symbol]: identity, [CURRENT_EXPERIMENT as symbol]: computed(() => exp) } } });
  await flushPromises();
  return { wrapper, router };
}

describe("Overview goals", () => {
  it("puts the traffic light inside the error, latency and cost cards", async () => {
    const identity = new FakeIdentityApi();
    identity.alerts = {
      rules: [{ rule: rule({}), status: status("firing", 7) }, { rule: rule({ id: "r2", metric: "latency_p95", threshold: 5000 }), status: status("ok", 2700) }],
      events: [],
      budget,
    };
    const { wrapper } = await open(identity);
    expect(wrapper.get('[data-testid="goal-errors"]').text()).toContain("Over goal");
    expect(wrapper.get('[data-testid="goal-line-errors"]').text()).toContain("Goal under 3 %");
    expect(wrapper.get('[data-testid="goal-line-errors"]').text()).toContain("now 7 %");
    expect(wrapper.get('[data-testid="goal-latency"]').text()).toContain("On track");
    expect(wrapper.get('[data-testid="goal-cost"]').text()).toContain("On track");
    expect(wrapper.find('[data-testid="goal-conversations"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="goals-welcome"]').exists()).toBe(false);
  });

  it("invites to set a monthly budget when there is none and the person can manage alerts", async () => {
    const identity = new FakeIdentityApi();
    identity.alerts = { rules: [{ rule: rule({}), status: status("ok", 1) }], events: [], budget: null };
    const { wrapper } = await open(identity);
    expect(wrapper.get('[data-testid="goal-cost"]').text()).toContain("No goal");
    expect(wrapper.get('[data-testid="goal-line-cost"]').text()).toContain("Set a monthly budget");
  });

  it("on a first visit explains goals and turns the starter ones on with one click", async () => {
    const identity = new FakeIdentityApi();
    const { wrapper } = await open(identity);
    expect(wrapper.get('[data-testid="goals-welcome"]').text()).toContain("Set goals");
    await wrapper.get('[data-testid="starter-goals"]').trigger("click");
    await flushPromises();
    expect(identity.alertCalls.filter((c) => c.op === "create")).toHaveLength(2);
    expect(identity.alertCalls.map((c) => (c.body as AlertRuleDto).metric)).toEqual(["error_rate", "latency_p95"]);
    expect(wrapper.find('[data-testid="goals-welcome"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="goal-errors"]').exists()).toBe(true);
  });

  it("shows nothing about goals to someone who cannot manage alerts and has none", async () => {
    const { wrapper } = await open(new FakeIdentityApi(), "business");
    expect(wrapper.find('[data-testid="goals-welcome"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="goal-cost"]').exists()).toBe(false);
  });
});
