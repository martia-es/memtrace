import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, Quasar } from "quasar";
import { afterEach, describe, expect, it } from "vitest";
import type { PromptMapDto } from "@contract";
import { PROMPT_API } from "@/dependency-container";
import PromotePromptModal from "@/ui/components/PromotePromptModal.vue";
import PromptDependencyMap from "@/ui/components/PromptDependencyMap.vue";
import { FakePromptApi } from "../fakes-prompts";

const map = (extra: Partial<PromptMapDto> = {}): PromptMapDto => ({ agents: [], dataset: null, includes: [], usedBy: [], impact: null, ...extra });

function mountWith(component: object, props: Record<string, unknown>, api: FakePromptApi) {
  return mount(component, { attachTo: document.body, props, global: { plugins: [[Quasar, { plugins: { Dark, Notify } }]], provide: { [PROMPT_API as symbol]: api } } });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("dependency map (ADR-074)", () => {
  it("says what each agent serves per environment and what dataset evaluates the prompt", async () => {
    const api = new FakePromptApi();
    api.mapResult = map({
      agents: [
        { experimentId: "a", name: "weather", serving: [{ environment: "pro", tag: "pro", version: 3, lastSeenAt: "2026-10-09T10:00:00.000Z" }, { environment: "dev", tag: "dev", version: 4, lastSeenAt: "2026-10-09T10:00:00.000Z" }] },
        { experimentId: "b", name: "billing", serving: [] },
      ],
      dataset: { id: "ds", name: "golden", experimentId: "a", requiredRuns: 2 },
    });
    const wrapper = mountWith(PromptDependencyMap, { promptId: "p1", kind: "prompt" }, api);
    await flushPromises();
    const weather = wrapper.find("[data-testid='map-agent-weather']").text();
    expect(weather).toContain("dev · dev → v4");
    expect(weather.indexOf("dev ·")).toBeLessThan(weather.indexOf("pro ·")); // environments in promotion order
    expect(wrapper.find("[data-testid='map-agent-billing']").text()).toContain("has not reported reading it yet");
    expect(wrapper.find("[data-testid='map-dataset']").text()).toContain("golden");
    expect(wrapper.find("[data-testid='map-dataset']").text()).toContain("2 runs");
  });

  it("says plainly that there is no promotion policy", async () => {
    const api = new FakePromptApi();
    api.mapResult = map({ agents: [{ experimentId: "a", name: "weather", serving: [] }] });
    const wrapper = mountWith(PromptDependencyMap, { promptId: "p1", kind: "prompt" }, api);
    await flushPromises();
    expect(wrapper.find("[data-testid='map-dataset']").text()).toContain("No promotion policy");
  });

  it("a fragment shows who includes it and who is behind, and no agents section", async () => {
    const api = new FakePromptApi();
    api.mapResult = map({ usedBy: [{ promptId: "x", name: "weather-system", version: 3, outdated: true }] });
    const wrapper = mountWith(PromptDependencyMap, { promptId: "p1", kind: "fragment" }, api);
    await flushPromises();
    expect(wrapper.find("[data-testid='map-used-by']").text()).toContain("weather-system");
    expect(wrapper.find("[data-testid='map-used-by']").text()).toContain("behind");
    expect(wrapper.find("[data-testid='map-agents']").exists()).toBe(false);
  });

  it("shows an empty state when nothing depends on it", async () => {
    const wrapper = mountWith(PromptDependencyMap, { promptId: "p1", kind: "prompt" }, new FakePromptApi());
    await flushPromises();
    expect(wrapper.text()).toContain("Nothing depends on this yet");
  });
});

describe("impact in the promotion modal (ADR-074)", () => {
  const modal = async (api: FakePromptApi) => {
    mountWith(PromotePromptModal, { promptId: "p1", tag: "pro", version: 4, reason: "", canBypass: false }, api);
    await flushPromises();
    return document.body;
  };

  it("asks for the impact of exactly this move and lists the agents that would receive it", async () => {
    const api = new FakePromptApi();
    api.mapResult = map({ impact: { tag: "pro", toVersion: 4, pinned: 1, willBeBehind: [], agents: [{ experimentId: "a", name: "weather", environment: "pro", from: 3, to: 4, changes: true }] } });
    const body = await modal(api);
    expect(api.calls.find((c) => c.method === "map")?.args[1]).toEqual({ tag: "pro", version: 4 });
    expect(body.querySelector("[data-testid='impact-weather']")!.textContent).toContain("v3 → v4");
    expect(body.querySelector("[data-testid='promote-impact']")!.textContent).toContain("1 agent uses a fixed version");
  });

  it("says nothing changes when no agent follows the tag", async () => {
    const api = new FakePromptApi();
    api.mapResult = map({ impact: { tag: "pro", toVersion: 4, pinned: 0, willBeBehind: [], agents: [{ experimentId: "a", name: "weather", environment: "pro", from: 4, to: 4, changes: false }] } });
    const body = await modal(api);
    expect(body.querySelector("[data-testid='impact-weather']")).toBeNull();
    expect(body.querySelector("[data-testid='impact-none']")).not.toBeNull();
  });

  it("warns that prompts including a fragment will be behind, without changing them", async () => {
    const api = new FakePromptApi();
    api.mapResult = map({ impact: { tag: "pro", toVersion: 4, pinned: 0, agents: [], willBeBehind: [{ promptId: "x", name: "weather-system" }] } });
    const body = await modal(api);
    expect(body.querySelector("[data-testid='impact-behind']")!.textContent).toContain("weather-system");
  });

  it("does not block promoting when the impact cannot be loaded", async () => {
    const api = new FakePromptApi();
    api.map = async () => {
      throw new Error("boom");
    };
    const body = await modal(api);
    expect(body.querySelector("[data-testid='promote-impact']")).toBeNull();
    expect(body.querySelector("[data-testid='promote-confirm']")).not.toBeNull();
  });
});
