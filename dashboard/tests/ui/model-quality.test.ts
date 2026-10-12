import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import type { ModelQualityCandidateDto, ModelQualityItemDto, ModelQualityResponse } from "@contract";
import { IDENTITY_API, TRACE_API } from "@/dependency-container";
import { EMPTY_THEME, type ExperimentDto } from "@/application/identity-api";
import AlertBell from "@/ui/components/AlertBell.vue";
import ModelPricingPage from "@/ui/pages/ModelPricingPage.vue";
import { permissionsOf } from "../permissions";
import { FakeIdentityApi, FakeTraceApi } from "../fakes";

// Costs › Model pricing con la calidad de Arena (ADR-025): columna, estados, filtros, confirmación y campana

const exp = (role: string): ExperimentDto => ({ id: "exp-1", organizationId: "org-1", name: "Weather", serviceName: "weather", myRole: role, permissions: permissionsOf(role), organizationTheme: EMPTY_THEME });
const price = (modelId: string, provider = "anthropic") => ({ modelId, provider, inputPricePerToken: 3e-6, outputPricePerToken: 15e-6, source: "litellm", updatedAt: new Date(Date.now() - 3600_000).toISOString() });
const score = (arenaName: string, elo: number, over: Partial<NonNullable<ModelQualityItemDto["quality"]>> = {}) => ({ arenaName, elo, ci: 4, rank: 15, votes: 66315, origin: "exact" as const, stale: false, ...over });
const candidate = (arenaName: string, elo: number, reason: string): ModelQualityCandidateDto => ({ arenaName, elo, ci: 3, rank: 79, votes: 82735, reason });
const item = (modelId: string, over: Partial<ModelQualityItemDto> = {}): ModelQualityItemDto => ({
  modelId, modelKey: modelId, state: "matched", inUse: false, quality: score(modelId, 1483), candidate: null, candidateCount: 0, via: null, ...over,
});
const sonnet = item("claude-sonnet-4-5", { state: "candidate", inUse: true, quality: null, candidateCount: 2, candidate: candidate("claude-sonnet-4-5-20250929", 1439, "Same name plus “20250929”") });
const response = (over: Partial<ModelQualityResponse> = {}): ModelQualityResponse => ({
  source: { name: "Arena", board: "text", category: "overall", license: "CC BY 4.0", url: "https://arena.ai", publishedAt: "2026-10-08T00:00:00.000Z", syncedAt: "2026-10-10T03:00:00.000Z" },
  items: [item("claude-opus-4-7"), sonnet, item("gemini-3-flash-preview", { state: "candidate", quality: null, candidateCount: 1, candidate: candidate("gemini-3-flash", 1466, "Same name without “preview”") }), item("gpt-5.2", { inUse: true, quality: score("gpt-5.2", 1412, { rank: 135 }) }), item("azure/gpt-5.2", { modelKey: "gpt-5.2", via: "gpt-5.2", quality: score("gpt-5.2", 1412, { rank: 135 }) })],
  counts: { needsReview: 2, pending: 1, inUse: 2 }, ...over,
});

class Identity extends FakeIdentityApi {
  role = "technical";
  override async listExperiments() {
    return [exp(this.role)];
  }
}

let mounted: VueWrapper | undefined;
let api: Identity;
let trace: FakeTraceApi;
beforeEach(() => {
  api = new Identity();
  api.modelQuality = response();
  api.modelQualityCandidates = {
    items: [
      { modelKey: "claude-sonnet-4-5", model: "claude-sonnet-4-5", inUse: true, candidates: [candidate("claude-sonnet-4-5-20250929", 1439, "Same name plus “20250929”"), candidate("claude-sonnet-4-5-20250929-high-32k", 1435, "Same release, high effort")] },
      { modelKey: "gemini-3-flash-preview", model: "gemini-3-flash-preview", inUse: false, candidates: [candidate("gemini-3-flash", 1466, "Same name without “preview”")] },
    ],
  };
  trace = new FakeTraceApi();
  trace.modelPricing = ["claude-opus-4-7", "claude-sonnet-4-5", "gemini-3-flash-preview", "gpt-5.2", "azure/gpt-5.2", "mistral-large"].map((id) => price(id));
});
afterEach(() => {
  mounted?.unmount();
  document.body.innerHTML = "";
});

async function openPage(query = "") {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/model-pricing", name: "model-pricing", component: { template: "<div />" } }] });
  await router.push(`/model-pricing${query}`);
  await router.isReady();
  const Host = defineComponent({ setup: () => () => h(QLayout, () => h(QPageContainer, () => h(ModelPricingPage))) });
  mounted = mount(Host, { attachTo: document.body, global: { plugins: [[Quasar, { plugins: { Dark, Notify } }], router], provide: { [TRACE_API as symbol]: trace, [IDENTITY_API as symbol]: api } } });
  await flushPromises();
  return router;
}
const q = <T extends HTMLElement = HTMLElement>(id: string) => document.body.querySelector<T>(`[data-testid='${id}']`);
const text = (id: string) => q(id)?.textContent?.replace(/\s+/g, " ").trim() ?? "";
const click = async (id: string) => {
  q(id)!.click();
  await flushPromises();
};

describe("the quality column", () => {
  it("shows the Elo, its margin, the rank and where an inherited score comes from", async () => {
    await openPage();
    expect(text("quality-claude-opus-4-7")).toContain("1483");
    expect(text("quality-claude-opus-4-7")).toContain("±4");
    expect(text("quality-claude-opus-4-7")).toContain("#15");
    expect(text("quality-azure/gpt-5.2")).toContain("via gpt-5.2");
    expect(q("quality-claude-opus-4-7 b")).toBeNull();
    expect(document.body.textContent).toContain("Quality · Arena Elo");
  });

  it("marks the models the agent uses", async () => {
    await openPage();
    expect(q("price-row-claude-sonnet-4-5")!.querySelector("[data-testid='in-use']")).not.toBeNull();
    expect(q("price-row-claude-opus-4-7")!.querySelector("[data-testid='in-use']")).toBeNull();
  });

  it("offers a button with the Arena name when there is a candidate, and says it plainly when there is none", async () => {
    await openPage();
    expect(text("quality-claude-sonnet-4-5")).toContain("Arena: claude-sonnet-4-5-20250929");
    expect(text("quality-claude-sonnet-4-5")).toContain("Confirm match →");
    expect(text("quality-mistral-large")).toContain("No Arena equivalent");
  });

  it("says it was decided when Arena does not list the model", async () => {
    api.modelQuality = response({ items: [item("mistral-large", { state: "no_equivalent", quality: null })] });
    await openPage();
    expect(text("quality-mistral-large")).toContain("Arena doesn't list it");
  });

  it("marks a score that left the leaderboard", async () => {
    api.modelQuality = response({ items: [item("claude-opus-4-7", { quality: score("claude-opus-4-7", 1483, { stale: true }) })] });
    await openPage();
    expect(text("quality-claude-opus-4-7")).toContain("no longer ranked");
  });

  it("names Arena, the date of the leaderboard and the licence", async () => {
    await openPage();
    expect(text("quality-attribution")).toContain("Arena");
    expect(text("quality-attribution")).toContain("8 Oct 2026");
    expect(text("quality-attribution")).toContain("CC BY 4.0");
    expect(text("quality-attribution")).toContain("human preference in chat, not accuracy on your task");
  });

  it("keeps prices working and hides the column before the first sync", async () => {
    api.modelQuality = response({ source: { ...response().source, publishedAt: null, syncedAt: null }, items: [], counts: { needsReview: 0, pending: 0, inUse: 0 } });
    await openPage();
    expect(q("price-row-claude-opus-4-7")).not.toBeNull();
    expect(q("quality-claude-opus-4-7")).toBeNull();
    expect(q("quality-banner")).toBeNull();
    expect(text("quality-pending-sync")).toContain("after the first daily sync");
  });

  it("keeps prices working when the scores cannot be loaded", async () => {
    api.modelQualityError = new Error("down");
    await openPage();
    expect(q("price-row-claude-opus-4-7")).not.toBeNull();
    expect(q("quality-claude-opus-4-7")).toBeNull();
  });

  it("works for a person who cannot read any agent", async () => {
    api.listExperiments = async () => [];
    await openPage();
    expect(q("price-row-claude-opus-4-7")).not.toBeNull();
    expect(q("quality-banner")).toBeNull();
    expect(api.modelQualityCalls).toEqual([]);
  });
});

describe("filters", () => {
  it("shows only the models in use with ?show=in_use, and says which agent", async () => {
    await openPage("?show=in_use");
    expect([...document.body.querySelectorAll("[data-testid^='price-row-']")].map((r) => r.getAttribute("data-testid"))).toEqual(["price-row-claude-sonnet-4-5", "price-row-gpt-5.2"]);
    expect(document.body.textContent).toContain("seen in the traces of Weather");
  });

  it("shows only the models that wait for a decision with ?show=review", async () => {
    await openPage("?show=review");
    expect([...document.body.querySelectorAll("[data-testid^='price-row-']")].map((r) => r.getAttribute("data-testid"))).toEqual(["price-row-claude-sonnet-4-5", "price-row-gemini-3-flash-preview"]);
  });

  it("writes the filter in the url and leaves the default out", async () => {
    const router = await openPage();
    document.body.querySelector<HTMLElement>("[aria-label='Models to show'] button:nth-child(2)")!.click();
    await flushPromises();
    expect(router.currentRoute.value.query.show).toBe("in_use");
    document.body.querySelector<HTMLElement>("[aria-label='Models to show'] button:nth-child(1)")!.click();
    await flushPromises();
    expect(router.currentRoute.value.query.show).toBeUndefined();
  });

  it("sorts by quality with the unscored models last, in both directions", async () => {
    await openPage();
    const order = () => [...document.body.querySelectorAll("[data-testid^='price-row-']")].map((r) => r.getAttribute("data-testid")!.replace("price-row-", ""));
    const header = [...document.body.querySelectorAll<HTMLElement>("button.sort")].find((b) => b.textContent?.includes("Quality"))!;
    header.click();
    await flushPromises();
    expect(order().slice(0, 2)).toEqual(["claude-opus-4-7", "gpt-5.2"]);
    expect(order().slice(-3).every((id) => ["claude-sonnet-4-5", "gemini-3-flash-preview", "mistral-large"].includes(id))).toBe(true);
    header.click();
    await flushPromises();
    expect(order().slice(0, 2).every((id) => ["gpt-5.2", "azure/gpt-5.2"].includes(id))).toBe(true);
    expect(order().slice(-3).every((id) => ["claude-sonnet-4-5", "gemini-3-flash-preview", "mistral-large"].includes(id))).toBe(true);
  });
});

describe("the banner", () => {
  it("counts the models you use that have no score, and leads to the review", async () => {
    await openPage();
    expect(text("quality-banner")).toContain("1 model you use has no quality score yet");
    expect(text("quality-banner")).toContain("Prices and costs are not affected");
    await click("review-matches");
    expect(q("match-drawer")).not.toBeNull();
  });

  it("says who can decide to a person who cannot, and offers no button", async () => {
    api.role = "business";
    await openPage();
    expect(text("quality-banner")).toContain("Someone with the technical profile can confirm it");
    expect(q("review-matches")).toBeNull();
    expect(q("confirm-claude-sonnet-4-5")).toBeNull();
    expect(text("quality-claude-sonnet-4-5")).toContain("Awaiting confirmation");
  });

  it("stays quiet when only models you do not use wait for a match, and the Needs review view still lists them", async () => {
    api.modelQuality = response({ counts: { needsReview: 185, pending: 0, inUse: 2 } });
    await openPage();
    expect(q("quality-banner")).toBeNull();
    const scope = document.body.querySelector("[aria-label='Models to show']")!;
    expect(scope.textContent).toContain("185");
  });

  it("is not there when every model has a decision", async () => {
    api.modelQuality = response({ counts: { needsReview: 0, pending: 0, inUse: 2 } });
    await openPage();
    expect(q("quality-banner")).toBeNull();
  });
});

describe("confirming matches", () => {
  it("opens from the row button, on that model", async () => {
    await openPage();
    await click("confirm-claude-sonnet-4-5");
    expect(api.modelQualityCalls.filter((c) => c.op === "candidates")).toEqual([{ op: "candidates", experimentId: "exp-1", scope: "all" }]);
    expect(q("match-card-claude-sonnet-4-5")).not.toBeNull();
    expect(text("match-drawer")).toContain("Your model");
    expect(text("match-drawer")).toContain("CLOSEST NAME");
    expect(text("match-drawer")).toContain("nothing changes in how your agent runs");
  });

  it("opens by itself with ?review=1 (the notice in the bell), and closes back to the plain url", async () => {
    const router = await openPage("?review=1");
    expect(q("match-drawer")).not.toBeNull();
    await click("match-close");
    expect(q("match-drawer")).toBeNull();
    expect(router.currentRoute.value.query.review).toBeUndefined();
  });

  it("does not open for a person who cannot decide", async () => {
    api.role = "business";
    await openPage("?review=1");
    expect(q("match-drawer")).toBeNull();
  });

  it("starts with the models in use and keeps the others one tab away", async () => {
    await openPage("?review=1");
    expect(q("match-card-claude-sonnet-4-5")).not.toBeNull();
    expect(q("match-card-gemini-3-flash-preview")).toBeNull();
    document.body.querySelector<HTMLElement>("[aria-label='Models to review'] button:nth-child(2)")!.click();
    await flushPromises();
    expect(q("match-card-gemini-3-flash-preview")).not.toBeNull();
  });

  it("confirms the closest name by default, saves it, and takes the model off the list", async () => {
    await openPage("?review=1");
    await click("match-confirm-claude-sonnet-4-5");
    expect(api.modelQualityCalls).toContainEqual({ op: "decide", experimentId: "exp-1", modelKey: "claude-sonnet-4-5", body: { decision: "confirm", arenaName: "claude-sonnet-4-5-20250929" } });
    expect(q("match-card-claude-sonnet-4-5")).toBeNull();
    // la tabla se vuelve a pedir para enseñar la puntuación
    expect(api.modelQualityCalls.filter((c) => c.op === "overview").length).toBe(2);
  });

  it("confirms the entry the person picked instead", async () => {
    await openPage("?review=1");
    q<HTMLInputElement>("match-option-claude-sonnet-4-5-1")!.click();
    await flushPromises();
    await click("match-confirm-claude-sonnet-4-5");
    expect(api.modelQualityCalls).toContainEqual({ op: "decide", experimentId: "exp-1", modelKey: "claude-sonnet-4-5", body: { decision: "confirm", arenaName: "claude-sonnet-4-5-20250929-high-32k" } });
  });

  it("rejects every entry offered with «None of these»", async () => {
    await openPage("?review=1");
    await click("match-none-claude-sonnet-4-5");
    expect(api.modelQualityCalls).toContainEqual({
      op: "decide", experimentId: "exp-1", modelKey: "claude-sonnet-4-5",
      body: { decision: "reject", arenaNames: ["claude-sonnet-4-5-20250929", "claude-sonnet-4-5-20250929-high-32k"] },
    });
    expect(q("match-card-claude-sonnet-4-5")).toBeNull();
  });

  it("marks the model as not listed with «Arena doesn't list it»", async () => {
    await openPage("?review=1");
    await click("match-noequiv-claude-sonnet-4-5");
    expect(api.modelQualityCalls).toContainEqual({ op: "decide", experimentId: "exp-1", modelKey: "claude-sonnet-4-5", body: { decision: "no_equivalent" } });
  });

  it("keeps the card and says what failed when the decision cannot be saved", async () => {
    await openPage("?review=1");
    api.modelQualityError = new Error("Missing permission: pricing:manage");
    await click("match-confirm-claude-sonnet-4-5");
    expect(text("match-error-claude-sonnet-4-5")).toContain("Missing permission: pricing:manage");
    expect(q("match-card-claude-sonnet-4-5")).not.toBeNull();
  });

  it("shows 20 models at a time and the rest on demand", async () => {
    const many = Array.from({ length: 45 }, (_, i) => ({ modelKey: `model-${String(i).padStart(2, "0")}`, model: `model-${i}`, inUse: true, candidates: [candidate(`model-${i}-2025`, 1400, "Same name plus a date")] }));
    api.modelQualityCandidates = { items: many };
    await openPage("?review=1");
    const cards = () => document.body.querySelectorAll("[data-testid^='match-card-']").length;
    expect(cards()).toBe(20);
    expect(text("match-more")).toContain("Show 20 more (25 left)");
    await click("match-more");
    expect(cards()).toBe(40);
    await click("match-more");
    expect(cards()).toBe(45);
    expect(q("match-more")).toBeNull();
  });

  it("says there is nothing to confirm when no model is waiting", async () => {
    api.modelQualityCandidates = { items: [] };
    await openPage("?review=1");
    expect(text("match-drawer")).toContain("Nothing to confirm");
  });
});

describe("the bell", () => {
  async function bell() {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: { template: "<div />" } }, { path: "/model-pricing", name: "model-pricing", component: { template: "<div />" } }, { path: "/e/:experimentId/alerts", name: "alerts", component: { template: "<div />" } }] });
    await router.push("/");
    await router.isReady();
    mounted = mount(AlertBell, { attachTo: document.body, global: { plugins: [[Quasar, { plugins: { Dark, Notify } }], router], provide: { [IDENTITY_API as symbol]: api } } });
    await flushPromises();
    return router;
  }
  const open = async () => {
    document.body.querySelector<HTMLElement>("[data-testid='alert-bell'] button")!.click();
    await flushPromises();
  };

  it("has no Models tab and no count when nothing is waiting", async () => {
    await bell();
    expect(q("bell-count")).toBeNull();
    await open();
    expect(q("tab-models")).toBeNull();
  });

  it("lists the models that wait for a decision as a pending state, not as an event", async () => {
    api.modelQualityPending = { total: 2, items: [{ experimentId: "exp-1", modelKey: "claude-sonnet-4-5", model: "claude-sonnet-4-5", candidateCount: 2 }, { experimentId: "exp-1", modelKey: "gemini-3-flash-preview", model: "gemini-3-flash-preview", candidateCount: 1 }] };
    await bell();
    expect(q("bell-count")!.textContent).toBe("1");
    await open();
    expect(text("tab-models")).toContain("2");
    expect(text("bell-models")).toContain("2 models you use need a quality match");
    expect(text("bell-models")).toContain("claude-sonnet-4-5 and gemini-3-flash-preview");
    expect(text("bell-models")).toContain("Pending");
    expect(text("bell-models")).toContain("prices and costs are not affected");
  });

  it("goes to Model pricing with the confirmation open", async () => {
    api.modelQualityPending = { total: 1, items: [{ experimentId: "exp-1", modelKey: "claude-sonnet-4-5", model: "claude-sonnet-4-5", candidateCount: 2 }] };
    const router = await bell();
    await open();
    await click("bell-models");
    expect(router.currentRoute.value.name).toBe("model-pricing");
    expect(router.currentRoute.value.query.review).toBe("1");
  });

  it("filters to the Models tab and says nothing is sent by email", async () => {
    api.modelQualityPending = { total: 1, items: [{ experimentId: "exp-1", modelKey: "claude-sonnet-4-5", model: "claude-sonnet-4-5", candidateCount: 2 }] };
    await bell();
    await open();
    await click("tab-models");
    expect(q("bell-models")).not.toBeNull();
    expect(q("bell-empty")).toBeNull();
  });
});
