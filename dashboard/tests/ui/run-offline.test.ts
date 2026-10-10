import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, Quasar } from "quasar";
import { afterEach, describe, expect, it } from "vitest";
import { ASSISTANT_API } from "@/dependency-container";
import RunOfflineModal from "@/ui/components/RunOfflineModal.vue";
import OfflineRunSteps from "@/ui/components/OfflineRunSteps.vue";
import { FakeAssistantApi, assistantCard, datasetVersionDto, deploymentDto } from "../fakes";

const versions = [datasetVersionDto({ id: "v2", major: 1, minor: 2, itemCount: 120 }), datasetVersionDto({ id: "v1", major: 1, minor: 1, itemCount: 100 })];
const chat = { path: "/chat", requestField: "message", responseField: "reply", sessionField: null, traceIdField: null };

async function open(api: FakeAssistantApi) {
  const wrapper = mount(RunOfflineModal, {
    props: { experimentId: "exp-1", datasetId: "ds-1", datasetName: "Refund questions", versions },
    global: { plugins: [[Quasar, { plugins: { Dark, Notify } }]], provide: { [ASSISTANT_API as symbol]: api } },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}
const code = () => document.body.querySelector('[data-testid="code"]')!.textContent ?? "";
const click = async (selector: string) => {
  (document.body.querySelector(selector) as HTMLElement).click();
  await flushPromises();
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Run offline modal", () => {
  it("builds a ready-to-run script for the agent's DEV deployment", async () => {
    const api = new FakeAssistantApi();
    api.card = assistantCard({ chat });
    const wrapper = await open(api);

    expect(document.body.querySelector('[data-testid="agent-url"]')!.textContent).toContain("https://dev.acme.test/weather/chat");
    expect(code()).toContain('json={"message": item.input}');
    expect(code()).toContain("evaluators=[exact_match]");
    wrapper.unmount();
  });

  it("adds the judge to the script and its key to the .env when Correctness is ticked", async () => {
    const api = new FakeAssistantApi();
    api.card = assistantCard({ chat });
    const wrapper = await open(api);

    await click('[data-testid="metric-correctness"]');
    expect(code()).toContain("Correctness(client=AnthropicJudgeClient())");
    await click('[data-testid="tab-env"]');
    expect(code()).toContain("ANTHROPIC_API_KEY");
    expect(code()).toContain('MEMTRACE_API_URL="' + window.location.origin + '/api/v1/experiments/exp-1"');
    wrapper.unmount();
  });

  it("falls back to a function to fill in when the agent has no chat", async () => {
    const api = new FakeAssistantApi();
    api.card = assistantCard({ chat: null, deployments: [deploymentDto("dev", "up")] });
    const wrapper = await open(api);

    expect(document.body.querySelector('[data-testid="no-agent"]')).not.toBeNull();
    expect(code()).toContain("NotImplementedError");
    wrapper.unmount();
  });

  it("cannot download without a metric", async () => {
    const api = new FakeAssistantApi();
    api.card = assistantCard({ chat });
    const wrapper = await open(api);

    await click('[data-testid="metric-exact_match"]');
    expect((document.body.querySelector('[data-testid="download-both"]') as HTMLButtonElement).disabled).toBe(true);
    wrapper.unmount();
  });

  it("colours the code and switches the language with the tab", async () => {
    const api = new FakeAssistantApi();
    api.card = assistantCard({ chat });
    const wrapper = await open(api);

    expect(document.body.querySelector('[data-testid="code"] .tok-keyword')).not.toBeNull();
    await click('[data-testid="tab-env"]');
    expect(document.body.querySelector('[data-testid="code"][data-lang="env"] .tok-key')).not.toBeNull();
    wrapper.unmount();
  });
});

describe("Offline run steps", () => {
  it("offers the generator from a dataset and a link to datasets elsewhere", async () => {
    const fromDataset = mount(OfflineRunSteps, { props: { datasetId: "ds-1" }, global: { plugins: [[Quasar, { plugins: { Dark, Notify } }]] } });
    await fromDataset.get('[data-testid="steps-open"]').trigger("click");
    expect(fromDataset.emitted("open")).toHaveLength(1);
    expect(fromDataset.text()).toContain("python run_eval.py");
  });
});
