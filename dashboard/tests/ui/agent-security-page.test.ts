import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import type { AgentSecurityDto } from "@contract";
import { ASSISTANT_API, IDENTITY_API, TRACE_API } from "@/dependency-container";
import AgentSecurityPage from "@/ui/pages/AgentSecurityPage.vue";
import { FakeAssistantApi, FakeIdentityApi, FakeTraceApi, emptySecurity } from "../fakes";

// ECharts needs a real canvas, which jsdom does not have: the chart is not what these tests are about
vi.mock("@/ui/components/EChart.vue", () => ({ default: { name: "EChart", template: '<div class="echart-stub" />' } }));

// Seguridad del agente (ADR-103): detecciones en producción y runs de red team, de solo lectura

const withData = (): AgentSecurityDto => ({
  days: 30,
  events: {
    total: 6, blocked: 3,
    byDetector: [{ detector: "tool_policy", count: 4 }, { detector: "secret_leak", count: 2 }],
    byCategory: [{ category: "unauthorized_tool", count: 4 }, { category: "secret_leak", count: 2 }],
    bySeverity: [{ severity: "error", count: 3 }, { severity: "warn", count: 3 }],
    byAction: [{ action: "blocked", count: 3 }, { action: "warned", count: 3 }],
    daily: [{ date: "2026-10-24", count: 5 }, { date: "2026-10-25", count: 1 }],
  },
  redteam: {
    runs: [
      { runId: "r2", datasetId: "d1", name: "redteam/weather", createdAt: "2026-10-25T10:00:00Z", revision: "abc1234def", items: 8, errored: 2, attacksSucceeded: 2, asr: 0.25,
        byCategory: [{ category: "prompt_injection", items: 4, attacksSucceeded: 2, asr: 0.5 }, { category: "jailbreak", items: 4, attacksSucceeded: 0, asr: 0 }] },
      { runId: "r1", datasetId: "d1", name: "redteam/weather", createdAt: "2026-10-20T10:00:00Z", revision: null, items: 8, errored: 0, attacksSucceeded: 0, asr: 0,
        byCategory: [{ category: "jailbreak", items: 8, attacksSucceeded: 0, asr: 0 }] },
    ],
  },
});

let mounted: VueWrapper | undefined;
afterEach(() => {
  mounted?.unmount();
  document.body.innerHTML = "";
});

async function open(assistants: FakeAssistantApi, query = "") {
  const stub = { template: "<div />" };
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/e/:experimentId/security", name: "security", component: stub },
    { path: "/e/:experimentId/datasets/:datasetId/runs/:runId", name: "dataset-run", component: stub },
  ] });
  await router.push(`/e/exp-1/security${query}`);
  await router.isReady();
  const Host = defineComponent({ setup: () => () => h(QLayout, () => h(QPageContainer, () => h(AgentSecurityPage))) });
  mounted = mount(Host, {
    attachTo: document.body,
    global: { plugins: [[Quasar, { plugins: { Dark, Notify } }], router], provide: { [TRACE_API as symbol]: new FakeTraceApi(), [IDENTITY_API as symbol]: new FakeIdentityApi(), [ASSISTANT_API as symbol]: assistants } },
  });
  await flushPromises();
  return router;
}
const q = <T extends HTMLElement = HTMLElement>(id: string) => document.body.querySelector<T>(`[data-testid='${id}']`);

describe("Agent security page", () => {
  it("asks for the last 30 days by default and shows the summary cards", async () => {
    const api = new FakeAssistantApi();
    api.security = withData();
    await open(api);
    expect(api.calls.filter((c) => c.method === "getSecurity").map((c) => c.args)).toEqual([["exp-1", 30]]);
    expect(q("kpi-events")?.textContent).toContain("6");
    expect(q("kpi-blocked")?.textContent).toContain("3");
    expect(q("kpi-asr")?.textContent).toContain("25%");
    expect(q("kpi-asr")?.textContent).toContain("redteam/weather");
  });

  it("lists detections by detector and by category with readable names", async () => {
    const api = new FakeAssistantApi();
    api.security = withData();
    await open(api);
    expect(q("detector-tool_policy")?.textContent).toContain("Tool policy");
    expect(q("detector-tool_policy")?.textContent).toContain("4");
    expect(q("category-unauthorized_tool")?.textContent).toContain("Unauthorized tool");
    expect(q("by-action")?.textContent).toContain("Blocked · 3");
  });

  it("shows each red team run with its ASR per category, its commit and a link to the run", async () => {
    const api = new FakeAssistantApi();
    api.security = withData();
    await open(api);
    expect(q("asr-r2")?.textContent).toContain("25%");
    expect(q("run-r2")?.textContent).toContain("abc1234");
    expect(q("run-r2")?.textContent).toContain("2 failed to run and are not counted");
    expect(q("cat-r2-prompt_injection")?.textContent).toContain("Prompt injection 50%");
    expect(q("run-r1")?.textContent).toContain("None got through");
    expect(q("run-link-r2")?.getAttribute("href")).toBe("/e/exp-1/datasets/d1/runs/r2");
  });

  it("explains how to start when there are no detections and no red team runs", async () => {
    const api = new FakeAssistantApi();
    await open(api);
    expect(q("events-empty")?.textContent).toContain("memtrace.security");
    expect(q("events-empty")?.textContent).toContain("prompt injection has no production detector");
    expect(q("redteam-empty")?.textContent).toContain("memtrace.redteam");
    expect(q("kpi-asr")?.textContent).toContain("No red team run yet");
  });

  it("follows the period of the URL and changes it from the selector", async () => {
    const api = new FakeAssistantApi();
    const router = await open(api, "?days=90");
    expect(api.calls.filter((c) => c.method === "getSecurity").at(-1)!.args).toEqual(["exp-1", 90]);
    q<HTMLButtonElement>("period-7")!.click();
    await flushPromises();
    expect(router.currentRoute.value.query.days).toBe("7");
    expect(api.calls.filter((c) => c.method === "getSecurity").at(-1)!.args).toEqual(["exp-1", 7]);
  });

  it("shows the error with a retry when the API fails", async () => {
    const api = new FakeAssistantApi();
    api.security = new Error("boom");
    await open(api);
    expect(document.body.textContent).toContain("boom");
    expect(q("kpi-events")).toBeNull();
  });
});
