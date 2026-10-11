import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, Quasar } from "quasar";
import { afterEach, describe, expect, it } from "vitest";
import { ASSISTANT_API } from "@/dependency-container";
import EditAssistantModal from "@/ui/components/assistants/EditAssistantModal.vue";
import { FakeAssistantApi, assistantCard } from "../fakes";

const github = { url: "https://github.com/acme/weather", provider: "github" as const, deployWorkflow: "deploy.yml", prGate: false };

async function open(repo: typeof github | null) {
  const api = new FakeAssistantApi();
  api.card = assistantCard({ repo });
  const wrapper = mount(EditAssistantModal, {
    props: { card: api.card },
    global: { plugins: [[Quasar, { plugins: { Dark, Notify } }]], provide: { [ASSISTANT_API as symbol]: api } },
    attachTo: document.body,
  });
  await flushPromises();
  return { api, wrapper };
}
const switchInput = () => document.body.querySelector('[data-testid="pr-gate"]') as HTMLInputElement | null;
const save = async () => {
  (document.body.querySelector('form button[type="submit"]') as HTMLElement).click();
  await flushPromises();
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Pull request gate switch (ADR-064, phase 3)", () => {
  it("is off by default and saves as part of the repository when turned on", async () => {
    const { api, wrapper } = await open(github);
    expect(switchInput()!.checked).toBe(false);
    switchInput()!.click();
    await flushPromises();
    await save();
    expect(api.calls.find((c) => c.method === "updateAssistant")!.args[1]).toMatchObject({ repo: { url: github.url, provider: "github", prGate: true } });
    wrapper.unmount();
  });

  it("shows the saved state", async () => {
    const { wrapper } = await open({ ...github, prGate: true });
    expect(switchInput()!.checked).toBe(true);
    wrapper.unmount();
  });

  it("is not offered without a repository", async () => {
    const { wrapper } = await open(null);
    expect(switchInput()).toBeNull();
    wrapper.unmount();
  });
});
