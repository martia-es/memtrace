import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { CURRENT_EXPERIMENT, IDENTITY_API, TRACE_API } from "@/dependency-container";
import { EMPTY_THEME, type ExperimentDto } from "@/application/identity-api";
import type { MemPatternsResponse } from "@contract";
import MemPatternsPage from "@/ui/pages/MemPatternsPage.vue";
import { permissionsOf } from "../permissions";
import { FakeIdentityApi, FakeTraceApi } from "../fakes";

const experiment: ExperimentDto = { id: "exp-1", organizationId: "org-1", name: "weather", serviceName: "weather-assistant", myRole: "technical", permissions: permissionsOf("technical"), organizationTheme: EMPTY_THEME };

const finding = (over: Record<string, unknown>) => ({
  findingId: "f1", cause: "search | KeyError: 'id'", rule: "goal_cluster=3 > 0.5", support: 35, failures: 32, failureRate: 0.91, lift: 3.5, pValue: 1e-9,
  decisiveStep: "search_flights", decisiveError: "KeyError: 'id'", toolSequence: "", occurrenceByPrompt: {}, exampleTraceIds: ["ab".repeat(16)], ...over,
});

async function mountPage(findings: unknown[]) {
  const stub = { template: "<div />" };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/e/:experimentId/patterns", name: "patterns", component: stub },
      { path: "/e/:experimentId/alerts", name: "alerts", component: stub },
      { path: "/e/:experimentId/traces/:traceId", name: "trace", component: stub },
    ],
  });
  await router.push("/e/exp-1/patterns");
  await router.isReady();
  const traces = new FakeTraceApi();
  traces.memPatterns = { runAt: "2026-11-27T04:20:00Z", episodes: 203, failed: 67, unexplained: 34, goalClusters: 10, findings } as unknown as MemPatternsResponse;
  const Host = defineComponent({ setup: () => () => h(QLayout, () => h(QPageContainer, () => h(MemPatternsPage))) });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: {
      plugins: [[Quasar, { plugins: { Dark, Notify } }], router],
      provide: { [TRACE_API as symbol]: traces, [IDENTITY_API as symbol]: new FakeIdentityApi(), [CURRENT_EXPERIMENT as symbol]: computed(() => experiment) },
    },
  });
  await flushPromises();
  return wrapper;
}

afterEach(() => { document.body.innerHTML = ""; });

describe("MemPatternsPage: arreglar desde un patrón", () => {
  it("un fallo del agente ofrece proponer arreglo y enseña el código con el id del hallazgo", async () => {
    const wrapper = await mountPage([finding({ occurrenceByPrompt: { "1": 8.24, "2": 0.84 } })]);
    expect(wrapper.find('[data-testid="mem-finding-snippet"]').exists()).toBe(false);
    await wrapper.get('[data-testid="mem-finding-fix"]').trigger("click");
    const code = wrapper.get('[data-testid="mem-finding-snippet"]').text();
    expect(code).toContain('f.finding_id == "f1"');
    expect(code).toContain("mem.save(lesson)");
    wrapper.unmount();
  });

  it("enseña la tendencia entre versiones del prompt", async () => {
    const wrapper = await mountPage([finding({ occurrenceByPrompt: { "1": 8.24, "2": 0.84 } })]);
    const trend = wrapper.get('[data-testid="mem-finding-trend"]').text();
    expect(trend).toContain("v1");
    expect(trend).toContain("8.2");
    expect(trend).toContain("v2");
    expect(trend).toContain("0.8");
    wrapper.unmount();
  });

  it("no hay tendencia con una sola versión", async () => {
    const wrapper = await mountPage([finding({ occurrenceByPrompt: { "1": 8.24 } })]);
    expect(wrapper.find('[data-testid="mem-finding-trend"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("un 429 no ofrece arreglar el prompt: propone vigilarlo con una alerta", async () => {
    const wrapper = await mountPage([finding({ cause: "chat | 429 Too Many Requests", decisiveStep: "chat", decisiveError: "429 Too Many Requests" })]);
    expect(wrapper.find('[data-testid="mem-finding-fix"]').exists()).toBe(false);
    expect(wrapper.find('a[href="/e/exp-1/alerts"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("copia el código al portapapeles", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const wrapper = await mountPage([finding({})]);
    await wrapper.get('[data-testid="mem-finding-fix"]').trigger("click");
    const copy = wrapper.findAll("button").find((b) => /Copy code|Copiar código/.test(b.text()))!;
    await copy.trigger("click");
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("mem.distill(finding, llm)"));
    wrapper.unmount();
  });
});
