import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { IDENTITY_API, TRACE_API } from "@/dependency-container";
import ConversationsPage from "@/ui/pages/ConversationsPage.vue";
import { FakeIdentityApi, FakeTraceApi, summary } from "../fakes";
import { chooseOption, optionLabels } from "./select";

const A = "3a08213f9b1c2d4e5f60718293a4b5c6d7e8f901";
const B = "b".repeat(40);

async function mountList(api: FakeTraceApi, path: string) {
  const stub = { template: "<div />" };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/overview", name: "overview", component: stub },
      { path: "/conversations", name: "conversations", component: stub },
      { path: "/traces/:traceId", name: "trace", component: stub },
      { path: "/conversations/:conversationId", name: "conversation", component: stub },
    ],
  });
  await router.push(path);
  await router.isReady();
  const Host = defineComponent({ setup: () => () => h(QLayout, () => h(QPageContainer, () => h(ConversationsPage))) });
  const wrapper = mount(Host, { attachTo: document.body, global: { plugins: [[Quasar, { plugins: { Dark, Notify } }], router], provide: { [TRACE_API as symbol]: api, [IDENTITY_API as symbol]: new FakeIdentityApi() } } });
  await flushPromises();
  return { wrapper, router };
}

describe("filter by code version in Conversations (ADR-065)", () => {
  const api = () => {
    const a = new FakeTraceApi();
    a.revisions = { items: [{ revision: A, traces: 12, lastSeen: new Date().toISOString() }, { revision: B, traces: 1, lastSeen: new Date(Date.now() - 3_600_000).toISOString() }] };
    a.pages = [{ items: [summary({ revision: A })], nextCursor: null }];
    return a;
  };

  it("offers the commits that produced traces, with how many, instead of asking to type a hash", async () => {
    const { wrapper } = await mountList(api(), "/conversations?group=flat");
    const labels = await optionLabels(wrapper.element, "[data-testid=revision-filter]");
    expect(labels[0]).toBe("All versions");
    expect(labels[1]).toMatch(/^3a08213 · 12 traces/);
    expect(labels[2]).toMatch(/^bbbbbbb · 1 trace ·/);
  });

  it("filters the list by the chosen commit and writes it in the URL", async () => {
    const a = api();
    const { wrapper, router } = await mountList(a, "/conversations?group=flat");
    await chooseOption(wrapper.element, "[data-testid=revision-filter]", labelOf(await optionLabels(wrapper.element, "[data-testid=revision-filter]"), "3a08213"));
    await flushPromises();
    expect(router.currentRoute.value.query.rev).toBe(A);
    expect(a.listCalls.at(-1)).toMatchObject({ revision: A });
  });

  it("keeps a filter that arrives in the URL visible even if that commit is outside the range", async () => {
    const { wrapper } = await mountList(api(), `/conversations?group=flat&rev=${"c".repeat(40)}`);
    expect(wrapper.get("[data-testid=revision-filter]").text()).toContain("ccccccc (not in this range)");
  });
});

const labelOf = (labels: string[], start: string) => labels.find((l) => l.startsWith(start))!;
