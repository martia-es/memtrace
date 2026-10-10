import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { Dark, Notify, Quasar } from "quasar";
import { IDENTITY_API, TRACE_API } from "@/dependency-container";
import CustomChartsPanel from "@/ui/components/CustomChartsPanel.vue";
import { FakeIdentityApi, FakeTraceApi } from "../../fakes";

class Api extends FakeTraceApi {
  async getStepKinds() {
    return { items: [{ stepType: "tool", count: 2 }, { stepType: "llm", count: 5 }, { stepType: "chain", count: 6 }] };
  }
  async getAttributeKeys() {
    return { items: [{ key: "gen_ai.tool.name", count: 2, kind: "category" as const, distinct: 3, numeric: false, hiddenByDefault: false }] };
  }
  queries: unknown[] = [];
  async queryCustomMetric(def?: unknown) {
    this.queries.push(def);
    const points = [{ label: "get_air_quality", value: 0.4 }, { label: "get_uv", value: 0.05 }, { label: "x", value: 0.02 }];
    return { points, timeseries: [{ bucketStart: "2026-10-01T00:00:00.000Z", points }] };
  }
  async getStepKindsX() { return null; }
}

const vueErrors: string[] = [];
HTMLCanvasElement.prototype.getContext = (() => ({ measureText: () => ({ width: 10 }), fillText() {}, save() {}, restore() {}, scale() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, rect() {}, clip() {}, setTransform() {}, translate() {}, rotate() {}, arc() {}, closePath() {}, createLinearGradient: () => ({ addColorStop() {} }), drawImage() {}, fillRect() {}, strokeText() {}, setLineDash() {}, quadraticCurveTo() {}, bezierCurveTo() {}, transform() {} })) as never;
let mounted: VueWrapper | undefined;
afterEach(() => mounted?.unmount());

describe("CustomChartsPanel", () => {
  it("keeps the whole builder and the chart on screen after picking a question", async () => {
    const errors = vi.spyOn(console, "warn").mockImplementation(() => {});
    mounted = mount(CustomChartsPanel, {
      props: { experimentId: "e1", range: { from: "2026-10-01T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z" } },
      global: { config: { errorHandler: (e: unknown) => { vueErrors.push(String(e)); }, warnHandler: (m: string) => { vueErrors.push(m); } }, plugins: [[Quasar, { plugins: { Dark, Notify } }]], provide: { [TRACE_API as symbol]: new Api(), [IDENTITY_API as symbol]: new FakeIdentityApi() } },
      attachTo: document.body,
    });
    await flushPromises();
    expect(mounted.text()).toContain("What do you want to know?");

    await mounted.find("button.mt-btn.v-link").trigger("click");
    const total = mounted.findAll(".question-card").length;
    expect(total).toBeGreaterThan(5);
    const settle = async () => {
      await flushPromises();
      await new Promise((r) => setTimeout(r, 400));
      await flushPromises();
    };
    await mounted.findAll(".question-card")[0]!.trigger("click");
    await settle();
    for (let i = 0; i < total; i++) {
      if (!mounted.find(".pill-row .mt-chip").exists()) await mounted.findAll("button.mt-btn.v-link").find((b) => b.text().startsWith("Try another"))!.trigger("click");
      await mounted.findAll(".pill-row .mt-chip")[i]!.trigger("click");
      await settle();
      expect(vueErrors, `question ${i}`).toEqual([]);
      for (const part of ["Save to Metrics", "I want to see", "Measured as", "Split by", "questions"]) expect(mounted.text(), `question ${i}`).toContain(part);
    }

    errors.mockRestore();
  });

  it("compares several steps in one chart and drops the split while more than one is picked", async () => {
    const api = new Api();
    mounted = mount(CustomChartsPanel, {
      props: { experimentId: "e1", range: { from: "2026-10-01T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z" } },
      global: { config: { errorHandler: (e: unknown) => { vueErrors.push(String(e)); } }, plugins: [[Quasar, { plugins: { Dark, Notify } }]], provide: { [TRACE_API as symbol]: api, [IDENTITY_API as symbol]: new FakeIdentityApi() } },
      attachTo: document.body,
    });
    await flushPromises();
    const chip = (label: string) => mounted!.findAll("button.mt-chip").find((b) => b.text().startsWith(label))!;
    await chip("Tool calls").trigger("click");
    await chip("Chain").trigger("click");
    await flushPromises();
    await new Promise((r) => setTimeout(r, 400));
    await flushPromises();

    expect(api.queries.at(-1)).toMatchObject({ stepTypes: ["tool", "chain"], groupByAttribute: null });
    expect(mounted.text()).toContain("Comparing 2 steps");
    expect((mounted.find(".add-condition").element as HTMLButtonElement).disabled).toBe(true);
    expect(vueErrors).toEqual([]);

    await chip("Chain").trigger("click");
    await flushPromises();
    expect((mounted.find(".add-condition").element as HTMLButtonElement).disabled).toBe(false);
  });
});
