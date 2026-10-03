import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, Quasar } from "quasar";
import { IDENTITY_API } from "@/dependency-container";
import ScoreConfigsPanel from "@/ui/components/ScoreConfigsPanel.vue";
import { FakeIdentityApi } from "../../fakes";

async function mountPanel(canManage: boolean, api = new FakeIdentityApi()) {
  const wrapper = mount(ScoreConfigsPanel, {
    props: { experimentId: "e1", canManage },
    global: { plugins: [[Quasar, { plugins: { Dark, Notify } }]], provide: { [IDENTITY_API as symbol]: api } },
    attachTo: document.body,
  });
  await flushPromises();
  return { wrapper, api };
}

describe("ScoreConfigsPanel", () => {
  it("shows an explanatory empty state to members without management buttons", async () => {
    const { wrapper } = await mountPanel(false);
    expect(wrapper.text()).toContain("No score configs yet");
    expect(wrapper.text()).toContain("An experiment admin needs to create them");
    expect(wrapper.text()).not.toContain("New score config");
  });

  it("lists existing configs with their scale", async () => {
    const api = new FakeIdentityApi();
    await api.createScoreConfig("e1", { name: "tone", dataType: "numeric", minValue: 1, maxValue: 5 });
    const { wrapper } = await mountPanel(true, api);
    const row = wrapper.get('[data-testid="score-config-row"]');
    expect(row.text()).toContain("tone");
    expect(row.text()).toContain("1 – 5");
    expect(row.text()).toContain("Archive");
  });

  it("archives a config and hides it from the default list", async () => {
    const api = new FakeIdentityApi();
    await api.createScoreConfig("e1", { name: "tone", dataType: "boolean" });
    const { wrapper } = await mountPanel(true, api);
    await wrapper.findAll("button").find((b) => b.text() === "Archive")!.trigger("click");
    await flushPromises();
    expect(wrapper.findAll('[data-testid="score-config-row"]')).toHaveLength(0);
    expect(api.scoreConfigs[0]!.archivedAt).not.toBeNull();
  });
});
