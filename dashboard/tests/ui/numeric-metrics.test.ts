import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { Dark, Notify, Quasar } from "quasar";
import { computed } from "vue";
import type { AttributeKeyDto, CustomMetricDefinitionDto } from "@contract";
import { CURRENT_EXPERIMENT, IDENTITY_API, TRACE_API } from "@/dependency-container";
import { EMPTY_THEME, type ExperimentDto, type SavedCustomMetricDto } from "@/application/identity-api";
import CustomChartsPanel from "@/ui/components/CustomChartsPanel.vue";
import { permissionsOf } from "../permissions";
import { FakeIdentityApi, FakeTraceApi } from "../fakes";
import { chooseOption, optionLabels } from "./select";

HTMLCanvasElement.prototype.getContext = (() => ({ measureText: () => ({ width: 10 }), fillText() {}, save() {}, restore() {}, scale() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, rect() {}, clip() {}, setTransform() {}, translate() {}, rotate() {}, arc() {}, closePath() {}, createLinearGradient: () => ({ addColorStop() {} }), drawImage() {}, fillRect() {}, strokeText() {}, setLineDash() {}, quadraticCurveTo() {}, bezierCurveTo() {}, transform() {} })) as never;

const attr = (key: string, kind: AttributeKeyDto["kind"], over: Partial<AttributeKeyDto> = {}): AttributeKeyDto => ({
  key,
  count: 10,
  kind,
  distinct: 5,
  numeric: false,
  hiddenByDefault: kind === "id" || kind === "text" || kind === "technical",
  ...over,
});

/** Un servidor con números que medir (un importe, una nota, tokens), un id numérico que no vale y una categoría que no es numérica. */
class Api extends FakeTraceApi {
  keys: AttributeKeyDto[] = [
    attr("city", "category", { distinct: 8 }),
    attr("order_total", "number", { distinct: 90, numeric: true }),
    attr("rating", "category", { distinct: 5, numeric: true }),
    attr("customer_id", "id", { distinct: 200, numeric: true }),
    attr("gen_ai.usage.input_tokens", "technical", { distinct: 80, numeric: true }),
  ];
  queries: CustomMetricDefinitionDto[] = [];
  async getStepKinds() {
    return { items: [{ stepType: "tool", count: 20 }, { stepType: "llm", count: 8 }] };
  }
  async getAttributeKeys() {
    return { items: this.keys };
  }
  async queryCustomMetric(def: CustomMetricDefinitionDto) {
    this.queries.push(def);
    const points = [{ label: "tool", value: 190 }];
    return { points, timeseries: [{ bucketStart: "2026-10-01T00:00:00.000Z", points }] };
  }
}

class Identity extends FakeIdentityApi {
  created: Array<{ name: string; definition: CustomMetricDefinitionDto }> = [];
  override async createCustomMetric(_e: string, name: string, definition: CustomMetricDefinitionDto): Promise<SavedCustomMetricDto> {
    this.created.push({ name, definition });
    return { id: "m1", name, definition, createdAt: "2026-10-09T10:00:00.000Z" };
  }
}

const exp = (role: string): ExperimentDto => ({ id: "e1", organizationId: "org-1", name: "weather", serviceName: "weather-assistant", myRole: role, permissions: permissionsOf(role), organizationTheme: EMPTY_THEME });
const RANGE = { from: "2026-10-01T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z" };

let mounted: VueWrapper | undefined;
afterEach(() => {
  mounted?.unmount();
  document.body.innerHTML = "";
});

async function open(api: Api, identity: FakeIdentityApi = new Identity()) {
  mounted = mount(CustomChartsPanel, {
    props: { experimentId: "e1", range: RANGE },
    global: {
      plugins: [[Quasar, { plugins: { Dark, Notify } }]],
      provide: { [TRACE_API as symbol]: api, [IDENTITY_API as symbol]: identity, [CURRENT_EXPERIMENT as symbol]: computed(() => exp("technical")) },
    },
    attachTo: document.body,
  });
  await flushPromises();
  return mounted;
}
const settle = async () => {
  await flushPromises();
  await new Promise((r) => setTimeout(r, 400));
  await flushPromises();
};
const chip = (w: VueWrapper, label: string) => w.findAll("button.chip").find((b) => b.text().startsWith(label))!;
const pickTool = async (w: VueWrapper) => {
  await chip(w, "Tool calls").trigger("click");
  await settle();
};
const measuredAs = (w: VueWrapper) => w.findAll(".field").find((f) => f.find("label").exists() && f.find("label").text().startsWith("Measured as"))!;

describe("measuring a number in the builder (ADR-077, phase 3)", () => {
  it("offers the metrics over a number only when the step has numbers, and lists those numbers", async () => {
    const w = await open(new Api());
    await pickTool(w);
    expect(await optionLabels(measuredAs(w).element, "[data-testid='metric-select']")).toEqual([
      "How many times",
      "How long it takes (average)",
      "How long it takes in the slowest 5%",
      "% that fail",
      "Total of a number",
      "Average of a number",
      "Lowest value of a number",
      "Highest value of a number",
    ]);
    await chooseOption(measuredAs(w).element, "[data-testid='metric-select']", "Total of a number");
    // el id numérico no se puede sumar; los tokens (detalle técnico) sí
    expect(await optionLabels(measuredAs(w).element, "[data-testid='measure-select']")).toEqual(["Order total", "Rating", "Input tokens"]);
  });

  it("says so when the step has nothing to measure, and does not offer the metrics", async () => {
    const api = new Api();
    api.keys = [attr("city", "category"), attr("customer_id", "id", { numeric: true })];
    const w = await open(api);
    await pickTool(w);
    expect((await optionLabels(measuredAs(w).element, "[data-testid='metric-select']")).length).toBe(4);
    expect(w.find("[data-testid='no-measures']").text()).toContain("no numbers");
  });

  it("choosing a metric over a number proposes the first number and computes the chart with it", async () => {
    const api = new Api();
    const w = await open(api);
    await pickTool(w);
    await chooseOption(measuredAs(w).element, "[data-testid='metric-select']", "Total of a number");
    await settle();
    expect(api.queries.at(-1)).toMatchObject({ metric: "sum_attribute", metricAttribute: "order_total", stepTypes: ["tool"] });
    // el nombre sugerido para guardarla
    expect(w.findAll("input").map((i) => (i.element as HTMLInputElement).value)).toContain("Total of order total in tool calls");
    // cambiar de número recalcula
    await chooseOption(measuredAs(w).element, "[data-testid='measure-select']", "Rating");
    await settle();
    expect(api.queries.at(-1)).toMatchObject({ metric: "sum_attribute", metricAttribute: "rating" });
    // y cambiar de operación conserva el número
    await chooseOption(measuredAs(w).element, "[data-testid='metric-select']", "Highest value of a number");
    await settle();
    expect(api.queries.at(-1)).toMatchObject({ metric: "max_attribute", metricAttribute: "rating" });
  });

  it("the table says which number it averages, and the headline shows it as a plain number", async () => {
    const api = new Api();
    const w = await open(api);
    await pickTool(w);
    await chooseOption(measuredAs(w).element, "[data-testid='metric-select']", "Average of a number");
    await settle();
    await w.findAll("button.seg-btn").find((b) => /table/i.test(b.text()))!.trigger("click");
    await settle();
    expect(w.find("table.result-table thead").text()).toContain("Average order total");
    expect(w.find("table.result-table tbody").text()).toContain("190"); // sin unidad ni porcentaje
  });

  it("going back to a usual metric drops the number, so the query never mixes them", async () => {
    const api = new Api();
    const w = await open(api);
    await pickTool(w);
    await chooseOption(measuredAs(w).element, "[data-testid='metric-select']", "Total of a number");
    await settle();
    await chooseOption(measuredAs(w).element, "[data-testid='metric-select']", "How many times");
    await settle();
    expect(api.queries.at(-1)).toMatchObject({ metric: "count", metricAttribute: null });
    expect(w.find("[data-testid='measure-select']").exists()).toBe(false);
  });

  it("picking a second step goes back to counting: a number belongs to one step", async () => {
    const api = new Api();
    const w = await open(api);
    await pickTool(w);
    await chooseOption(measuredAs(w).element, "[data-testid='metric-select']", "Total of a number");
    await settle();
    await chip(w, "Model calls").trigger("click");
    await settle();
    expect(api.queries.at(-1)).toMatchObject({ stepTypes: ["tool", "llm"], metric: "count", metricAttribute: null });
    expect(w.find("[data-testid='measure-select']").exists()).toBe(false);
  });

  it("saves the chart with the number it measures", async () => {
    const api = new Api();
    const identity = new Identity();
    const w = await open(api, identity);
    await pickTool(w);
    await chooseOption(measuredAs(w).element, "[data-testid='metric-select']", "Total of a number");
    await settle();
    const save = w.findAll("button").find((b) => b.text().includes("Save to Metrics"))!;
    await save.trigger("click");
    await settle();
    expect(identity.created).toHaveLength(1);
    expect(identity.created[0]!.definition).toMatchObject({ metric: "sum_attribute", metricAttribute: "order_total", stepTypes: ["tool"] });
  });

  it("every other definition still goes out with metricAttribute null", async () => {
    const api = new Api();
    const w = await open(api);
    await pickTool(w);
    expect(api.queries.at(-1)).toMatchObject({ metric: "count", metricAttribute: null });
  });
});
