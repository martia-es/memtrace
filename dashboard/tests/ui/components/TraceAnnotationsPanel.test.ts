import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, Quasar } from "quasar";
import type { AnnotationDto, ScoreConfigDto } from "@contract";
import { CURRENT_EXPERIMENT, IDENTITY_API, TRACE_API } from "@/dependency-container";
import TraceAnnotationsPanel from "@/ui/components/TraceAnnotationsPanel.vue";
import { FakeIdentityApi, FakeTraceApi } from "../../fakes";

const config = (overrides: Partial<ScoreConfigDto> = {}): ScoreConfigDto => ({
  id: "cfg-1",
  name: "tone",
  dataType: "numeric",
  minValue: 1,
  maxValue: 5,
  categories: null,
  description: "How polite was the answer?",
  createdAt: "",
  updatedAt: "",
  archivedAt: null,
  ...overrides,
});

const annotation = (overrides: Partial<AnnotationDto> = {}): AnnotationDto => ({
  configId: "cfg-1",
  configName: "tone",
  dataType: "numeric",
  value: "4",
  comment: null,
  spanId: null,
  annotator: { id: "me", name: "Ana" },
  createdAt: "2026-10-03T10:00:00.000Z",
  ...overrides,
});

class Identity extends FakeIdentityApi {
  async getMe() {
    return { id: "me", email: "a@x.io", name: "Ana", image: null };
  }
}

async function mountPanel(configs: ScoreConfigDto[], annotations: AnnotationDto[] = [], span: { spanId: string; name: string } | null = null, myRole: string = "member") {
  const identity = new Identity();
  identity.scoreConfigs = configs;
  const trace = new FakeTraceApi();
  trace.annotations = { annotations, scores: [] };
  const wrapper = mount(TraceAnnotationsPanel, {
    props: { traceId: "t1", experimentId: "e1", span },
    global: { plugins: [[Quasar, { plugins: { Dark, Notify } }]], provide: { [IDENTITY_API as symbol]: identity, [TRACE_API as symbol]: trace, [CURRENT_EXPERIMENT as symbol]: { value: { myRole } } } },
    attachTo: document.body,
  });
  await flushPromises();
  return { wrapper, trace, identity };
}

describe("TraceAnnotationsPanel", () => {
  it("lets an experiment admin create a score config inline and reloads the rubric", async () => {
    const { wrapper, identity } = await mountPanel([], [], null, "admin");
    await wrapper.get('[data-testid="new-config"]').trigger("click");
    const body = document.body;
    (body.querySelector('input[placeholder^="Name"]') as HTMLInputElement).value = "tone";
    body.querySelector('input[placeholder^="Name"]')!.dispatchEvent(new Event("input"));
    await flushPromises();
    body.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await flushPromises();
    expect(identity.scoreConfigs.map((c) => c.name)).toContain("tone");
    expect(wrapper.findAll('[data-testid="annotation-config"]')).toHaveLength(1);
  });

  it("does not offer inline creation to plain members", async () => {
    const { wrapper } = await mountPanel([]);
    expect(wrapper.find('[data-testid="new-config"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="no-configs"]').text()).toContain("Ask an experiment admin");
  });

  it("explains that score configs are needed when there are none", async () => {
    const { wrapper } = await mountPanel([]);
    expect(wrapper.get('[data-testid="no-configs"]').text()).toContain("no score configs");
  });

  it("renders buttons for short numeric scales and saves the chosen value with its comment", async () => {
    const { wrapper, trace } = await mountPanel([config()]);
    const save = wrapper.findAll("button").find((b) => b.text() === "Save")!;
    expect(save.attributes("disabled")).toBeDefined();

    await wrapper.findAll(".choice-btn").find((b) => b.text() === "4")!.trigger("click");
    await wrapper.get('input[aria-label="tone comment"]').setValue("  polite  ");
    await save.trigger("click");
    await flushPromises();

    expect(trace.savedAnnotations).toEqual([{ configId: "cfg-1", value: "4", comment: "polite", spanId: null }]);
  });

  it("uses Yes/No for booleans and the labels for categoricals", async () => {
    const { wrapper } = await mountPanel([
      config({ id: "b", name: "safe", dataType: "boolean", minValue: null, maxValue: null }),
      config({ id: "c", name: "style", dataType: "categorical", minValue: null, maxValue: null, categories: [{ label: "formal", value: null }, { label: "casual", value: null }] }),
    ]);
    const labels = wrapper.findAll(".choice-btn").map((b) => b.text());
    expect(labels).toEqual(["Yes", "No", "formal", "casual"]);
  });

  it("falls back to a number input for wide ranges", async () => {
    const { wrapper } = await mountPanel([config({ minValue: 0, maxValue: 100 })]);
    expect(wrapper.findAll(".choice-btn")).toHaveLength(0);
    expect(wrapper.find('input[type="number"]').exists()).toBe(true);
  });

  it("prefills my existing label and marks it as saved", async () => {
    const { wrapper } = await mountPanel([config()], [annotation({ value: "4", comment: "ok" })]);
    expect(wrapper.text()).toContain("your label saved");
    expect(wrapper.findAll(".choice-btn").find((b) => b.classes("active"))?.text()).toBe("4");
    expect((wrapper.get('input[aria-label="tone comment"]').element as HTMLInputElement).value).toBe("ok");
  });

  it("annotates the selected span when asked", async () => {
    const { wrapper, trace } = await mountPanel([config()], [], { spanId: "aaaaaaaaaaaaaaaa", name: "search" });
    await wrapper.findAll(".scope-btn").find((b) => b.text() === "Selected span")!.trigger("click");
    await wrapper.findAll(".choice-btn").find((b) => b.text() === "2")!.trigger("click");
    await wrapper.findAll("button").find((b) => b.text() === "Save")!.trigger("click");
    await flushPromises();
    expect(trace.savedAnnotations[0]).toMatchObject({ value: "2", spanId: "aaaaaaaaaaaaaaaa" });
  });

  it("shows others' labels with their author, and 'Former member' when the user is gone", async () => {
    const { wrapper } = await mountPanel(
      [config()],
      [annotation(), annotation({ annotator: { id: "u2", name: "Luis" }, value: "2" }), annotation({ annotator: { id: "gone", name: null }, value: "1" })],
    );
    const rows = wrapper.findAll('[data-testid="annotation-row"]').map((r) => r.text());
    expect(rows[0]).toContain("You");
    expect(rows[1]).toContain("Luis");
    expect(rows[2]).toContain("Former member");
  });

  it("lets a member retract only their own label", async () => {
    const { wrapper, trace } = await mountPanel([config()], [annotation(), annotation({ annotator: { id: "u2", name: "Luis" } })]);
    const buttons = wrapper.findAll('[data-testid="annotation-row"] .small-btn');
    expect(buttons).toHaveLength(1);
    await buttons[0]!.trigger("click");
    await flushPromises();
    expect(trace.retractions).toEqual([{ traceId: "t1", configId: "cfg-1", spanId: null }]);
  });
});
