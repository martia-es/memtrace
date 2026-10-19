import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { defineComponent, h } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { ASSISTANT_API, IDENTITY_API, TRACE_API } from "@/dependency-container";
import { EMPTY_THEME, type ExperimentDto, type OrganizationDto } from "@/application/identity-api";
import AssistantsPage from "@/ui/pages/AssistantsPage.vue";
import AssistantDetailPage from "@/ui/pages/AssistantDetailPage.vue";
import ClassifyRiskModal from "@/ui/components/assistants/ClassifyRiskModal.vue";
import { isLowering, levelOf } from "@/domain/risk";
import { permissionsOf } from "../permissions";
import { FakeAssistantApi, FakeIdentityApi, FakeTraceApi, assistantCard } from "../fakes";

// Clasificación de riesgo de los agentes (ADR-102): insignia en el catálogo y la ficha, y el modal que la declara

const org = (role: string): OrganizationDto => ({ id: "org-1", name: "Acme", myRole: role === "org_admin" ? "org_admin" : null, permissions: permissionsOf(role), theme: EMPTY_THEME });
const exp = (role: string): ExperimentDto => ({ id: "exp-1", organizationId: "org-1", name: "weather", serviceName: "weather-assistant", myRole: role, permissions: permissionsOf(role), organizationTheme: EMPTY_THEME });

class Identity extends FakeIdentityApi {
  constructor(private orgs: OrganizationDto[], private exps: ExperimentDto[]) { super(); }
  override async listOrganizations() { return this.orgs; }
  override async listExperiments() { return this.exps; }
}

const risk = (level: "minimal" | "limited" | "high" | null, over: object = {}) => ({ level, intendedPurpose: "", knownLimitations: "", classifiedBy: null, classifiedAt: null, ...over });

async function setup(component: object, path: string, assistants: FakeAssistantApi, identity: FakeIdentityApi, props: Record<string, unknown> = {}) {
  const stub = { template: "<div />" };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/assistants", name: "assistants", component: stub },
      { path: "/assistants/:expId", name: "assistant", component: stub },
      { path: "/e/:experimentId/overview", name: "overview", component: stub },
      { path: "/admin/experiments/:expId", name: "admin-experiment", component: stub },
      { path: "/admin/organizations/:organizationId", name: "admin-organization", component: stub },
    ],
  });
  await router.push(path);
  await router.isReady();
  const Host = defineComponent({ setup: () => () => h(QLayout, () => h(QPageContainer, () => h(component, props))) });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: { plugins: [[Quasar, { plugins: { Dark, Notify } }], router], provide: { [TRACE_API as symbol]: new FakeTraceApi(), [IDENTITY_API as symbol]: identity, [ASSISTANT_API as symbol]: assistants } },
  });
  await flushPromises();
  return { wrapper, router };
}

describe("risk rules", () => {
  it("only a move to a lower level is a lowering, and no level is shown as Unclassified", () => {
    expect(isLowering("high", "minimal")).toBe(true);
    expect(isLowering("minimal", "high")).toBe(false);
    expect(isLowering(null, "minimal")).toBe(false);
    expect(levelOf(risk(null))).toBe("unclassified");
    expect(levelOf(risk("limited"))).toBe("limited");
  });
});

describe("risk in the assistants catalog", () => {
  const cards = () => [
    assistantCard({ experimentId: "exp-1", name: "claims-assistant", risk: risk("high") }),
    assistantCard({ experimentId: "exp-2", name: "weather-assistant", risk: risk("minimal") }),
    assistantCard({ experimentId: "exp-3", name: "rag-assistant", risk: risk(null) }),
  ];
  const open = async () => {
    const api = new FakeAssistantApi();
    api.catalog = cards();
    return setup(AssistantsPage, "/assistants", api, new Identity([org("org_admin")], []));
  };
  const chip = (wrapper: ReturnType<typeof mount>, name: string) => wrapper.get(`[data-testid="assistant-card-${name}"] [data-testid="risk-chip"]`);

  it("puts a risk chip on every card, and Unclassified is a warning, never low risk", async () => {
    const { wrapper } = await open();
    expect(chip(wrapper, "claims-assistant").text()).toBe("High risk");
    expect(chip(wrapper, "weather-assistant").text()).toBe("Minimal risk");
    expect(chip(wrapper, "rag-assistant").text()).toBe("Unclassified");
    expect(chip(wrapper, "rag-assistant").classes()).toContain("t-warn");
    expect(chip(wrapper, "claims-assistant").classes()).toContain("t-error");
  });

  it("counts the unclassified agents in the summary", async () => {
    const { wrapper } = await open();
    expect(wrapper.get('[data-testid="unclassified-count"]').text()).toContain("1");
  });

  it("filters by risk level, with Unclassified as its own option", async () => {
    const { wrapper } = await open();
    await wrapper.get('button[aria-label^="Risk:"]').trigger("click");
    await flushPromises();
    const item = (label: string) => [...document.body.querySelectorAll<HTMLElement>(".pill-menu .opts > *")].find((e) => e.textContent?.trim() === label)!;
    item("Unclassified").click();
    await flushPromises();
    expect(wrapper.findAll("[data-testid^='assistant-card-']").map((c) => c.attributes("data-testid"))).toEqual(["assistant-card-rag-assistant"]);
  });
});

describe("risk on the assistant page", () => {
  const detail = (level: "minimal" | "limited" | "high" | null, identity: FakeIdentityApi) => {
    const api = new FakeAssistantApi();
    api.card = assistantCard({ risk: risk(level) });
    return setup(AssistantDetailPage, "/assistants/exp-1", api, identity, { experimentId: "exp-1" });
  };

  it("shows the level read-only with a link to where it is managed", async () => {
    const { wrapper } = await detail("high", new Identity([org("org_admin")], [exp("org_admin")]));
    const fact = wrapper.get('[data-testid="risk"]');
    expect(fact.text()).toContain("High");
    expect(fact.find("input, button").exists()).toBe(false);
    expect(wrapper.get('[data-testid="manage-risk"]').attributes("href")).toContain("/admin/organizations/org-1?tab=risk");
  });

  it("shows an unclassified agent as Unclassified", async () => {
    const { wrapper } = await detail(null, new Identity([org("org_admin")], [exp("org_admin")]));
    expect(wrapper.get('[data-testid="risk"]').text()).toContain("Unclassified");
  });

  it("does not link to Settings for someone who cannot read governance", async () => {
    const { wrapper } = await detail("high", new Identity([{ ...org("technical"), permissions: [] }], [exp("technical")]));
    expect(wrapper.find('[data-testid="manage-risk"]').exists()).toBe(false);
  });
});

describe("classify risk modal (ADR-102)", () => {
  // el modal se teletransporta al body: sin limpiarlo, cada prueba encontraría el de la anterior
  afterEach(() => {
    document.body.innerHTML = "";
  });
  const levelDays = { high: 365, limited: 90, minimal: 30, unclassified: 180 };
  const open = async (current: ReturnType<typeof risk>, canLower: boolean) => {
    const api = new FakeAssistantApi();
    api.card = assistantCard({ risk: current });
    const { wrapper } = await setup(ClassifyRiskModal, "/assistants", api, new Identity([org("org_admin")], []), { experimentId: "exp-1", name: "claims-assistant", levelDays, canLower });
    return { api, wrapper, body: document.body };
  };
  const pick = async (level: string) => {
    const radio = document.body.querySelector<HTMLInputElement>(`[data-testid="level-${level}"]`)!;
    radio.click();
    radio.dispatchEvent(new Event("change"));
    await flushPromises();
  };
  const saveButton = () => document.body.querySelector<HTMLButtonElement>('[data-testid="save-risk"]')!;
  const type = (testid: string, value: string) => {
    const el = document.body.querySelector<HTMLTextAreaElement>(`[data-testid="${testid}"]`)!;
    el.value = value;
    el.dispatchEvent(new Event("input"));
  };

  it("starts from what is declared and needs a level before saving", async () => {
    await open(risk(null), true);
    expect(saveButton().disabled).toBe(true);
    await pick("limited");
    expect(saveButton().disabled).toBe(false);
  });

  it("requires an intended purpose for High only", async () => {
    await open(risk(null), true);
    await pick("high");
    expect(saveButton().disabled).toBe(true);
    expect(document.body.textContent).toContain("Required for a high-risk agent");
    type("intended-purpose", "Classifies claims by urgency");
    await flushPromises();
    expect(saveButton().disabled).toBe(false);
  });

  it("saves the declaration", async () => {
    const { api } = await open(risk("limited", { intendedPurpose: "Answers questions" }), true);
    await pick("high");
    type("known-limitations", "Spanish only");
    await flushPromises();
    saveButton().click();
    await flushPromises();
    expect(api.calls.find((c) => c.method === "classifyRisk")!.args).toEqual(["exp-1", { level: "high", intendedPurpose: "Answers questions", knownLimitations: "Spanish only" }]);
  });

  it("refuses to lower the level unless the person is an organization admin", async () => {
    await open(risk("high", { intendedPurpose: "x" }), false);
    await pick("minimal");
    expect(document.body.querySelector('[data-testid="lowering-blocked"]')).not.toBeNull();
    expect(saveButton().disabled).toBe(true);
    await pick("high");
    expect(document.body.querySelector('[data-testid="lowering-blocked"]')).toBeNull();
  });

  it("warns that a lower level shortens the retention of its traces", async () => {
    await open(risk("high", { intendedPurpose: "x" }), true);
    await pick("minimal");
    const warning = document.body.querySelector('[data-testid="retention-shortens"]')!;
    expect(warning.textContent).toContain("30 days instead of 365");
    expect(saveButton().disabled).toBe(false);
    await pick("high");
    expect(document.body.querySelector('[data-testid="retention-shortens"]')).toBeNull();
  });
});
