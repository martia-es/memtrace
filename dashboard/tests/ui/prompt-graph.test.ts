import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, Quasar } from "quasar";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import type { PromptGraphResponse } from "@contract";
import { PROMPT_API } from "@/dependency-container";
import PromptGlobalGraph from "@/ui/components/PromptGlobalGraph.vue";
import { FakePromptApi } from "../fakes-prompts";

async function mountGraph(graph: PromptGraphResponse) {
  const api = new FakePromptApi();
  api.graphResult = graph;
  const stub = { template: "<div />" };
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/e/:experimentId/prompts/:promptId", name: "prompt", component: stub }, { path: "/", component: stub }] });
  await router.push("/");
  await router.isReady();
  const wrapper = mount(PromptGlobalGraph, { attachTo: document.body, props: { experimentId: "exp-1" }, global: { plugins: [[Quasar, { plugins: { Dark, Notify } }], router], provide: { [PROMPT_API as symbol]: api } } });
  await flushPromises();
  return { wrapper, router, api };
}

const node = (id: string, name: string, kind: "prompt" | "fragment", latestVersion = 1) => ({ id, name, kind, latestVersion });

afterEach(() => {
  document.body.innerHTML = "";
});

describe("global prompt graph", () => {
  it("draws a wire per include with the pinned version, and marks a fragment that moved on", async () => {
    const { wrapper } = await mountGraph({
      nodes: [node("f1", "tono", "fragment"), node("f2", "guardarrail", "fragment", 0), node("p1", "system-prompt", "prompt", 3)],
      edges: [{ fragmentId: "f1", promptId: "p1", ref: "pro", pinned: 1, current: 2, outdated: true }],
    });
    expect(wrapper.find("[data-testid='graph-wire-tono-system-prompt']").classes()).toContain("late");
    const text = wrapper.text();
    expect(text).toContain("@pro · pinned to v1");
    expect(text).toContain("now v2");
    expect(wrapper.find("[data-testid='graph-node-guardarrail']").classes()).toContain("unused"); // no prompt includes it
    expect(wrapper.find("[data-testid='graph-node-tono']").classes()).not.toContain("unused");
  });

  it("opens the prompt when its node is clicked", async () => {
    const { wrapper, router } = await mountGraph({ nodes: [node("f1", "tono", "fragment"), node("p1", "system-prompt", "prompt")], edges: [{ fragmentId: "f1", promptId: "p1", ref: "1", pinned: 1, current: 1, outdated: false }] });
    await wrapper.find("[data-testid='graph-node-system-prompt']").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.params).toMatchObject({ experimentId: "exp-1", promptId: "p1" });
  });

  it("shows nothing when there are no fragments, so a plain prompts list stays clean", async () => {
    const { wrapper } = await mountGraph({ nodes: [node("p1", "system-prompt", "prompt")], edges: [] });
    expect(wrapper.find("[data-testid='prompt-graph']").exists()).toBe(false);
  });
});
