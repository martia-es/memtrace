import { permissionsOf } from "../permissions";
import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { defineComponent, h } from "vue";
import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { IDENTITY_API, TRACE_API } from "@/dependency-container";
import { EMPTY_THEME, type ExperimentDto, type OrganizationDto } from "@/application/identity-api";
import { ApiError } from "@/application/trace-api";
import AdminOrganizationPage from "@/ui/pages/admin/AdminOrganizationPage.vue";
import { useSettingsNav } from "@/ui/composables/useSettingsNav";
import AdminExperimentPage from "@/ui/pages/admin/AdminExperimentPage.vue";
import { FakeIdentityApi, FakeTraceApi } from "../fakes";

// Retención, auditoría y exportación en Admin (ADR-084)

class Fake extends FakeIdentityApi {
  constructor(
    private orgs: OrganizationDto[],
    private exps: ExperimentDto[],
  ) {
    super();
  }
  override async listOrganizations() {
    return this.orgs;
  }
  override async listExperiments() {
    return this.exps;
  }
}

const org: OrganizationDto = { id: "org-1", name: "Acme", myRole: "org_admin", permissions: permissionsOf("org_admin"), theme: EMPTY_THEME };
const exp = (over: Partial<ExperimentDto> = {}): ExperimentDto => ({
  id: "exp-1", organizationId: "org-1", name: "Support bot", serviceName: "support-bot", myRole: "org_admin", permissions: permissionsOf("org_admin"), organizationTheme: EMPTY_THEME, ...over,
});

async function setup(component: object, path: string, identity: FakeIdentityApi) {
  const routes = [
    { path: "/admin", name: "admin", component: { template: "<div />" } },
    { path: "/admin/members", name: "admin-members", component: { template: "<div />" } },
    { path: "/assistants", name: "assistants", component: { template: "<div />" } },
    { path: "/admin/organizations/:organizationId", name: "admin-organization", component: { template: "<div />" }, props: true },
    { path: "/admin/experiments/:expId", name: "admin-experiment", component: { template: "<div />" }, props: (r: { params: Record<string, unknown> }) => ({ experimentId: r.params.expId }) },
    { path: "/e/:experimentId/conversations", name: "conversations", component: { template: "<div />" } },
  ];
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push(path);
  await router.isReady();
  const Host = defineComponent({ setup: () => () => h(QLayout, () => h(QPageContainer, () => h(component, { experimentId: "exp-1", organizationId: "org-1" }))) });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: { plugins: [[Quasar, { plugins: { Dark, Notify } }], router], provide: { [TRACE_API as symbol]: new FakeTraceApi(), [IDENTITY_API as symbol]: identity } },
  });
  await flushPromises();
  return { wrapper, router };
}

// las secciones de la organización viven en el menú lateral (useSettingsNav), no en pestañas de la página
const sectionLabels = () => (useSettingsNav().settingsNav.value?.sections ?? []).map((s) => s.label);
const tabLabels = (wrapper: ReturnType<typeof mount>) => wrapper.findAll('[role="tab"]').map((t) => t.text().replace(/\d+$/, "").trim());
const type = (el: Element | null | undefined, value: string) => {
  (el as HTMLInputElement).value = value;
  el!.dispatchEvent(new Event("input"));
};
const button = (wrapper: ReturnType<typeof mount>, text: string) => wrapper.findAll("button").filter((b) => b.text() === text);

const withRetention = (identity: Fake) => identity;

describe("Data protection tab (organization)", () => {
  it("is offered to people who can manage retention or read the audit log, and to nobody else", async () => {
    const { wrapper } = await setup(AdminOrganizationPage, "/admin/organizations/org-1", new Fake([org], [exp()]));
    expect(sectionLabels()).toContain("Data protection");
    expect(wrapper.exists()).toBe(true);

    const member = { ...org, myRole: null, permissions: [] };
    await setup(AdminOrganizationPage, "/admin/organizations/org-1", new Fake([member], [exp()]));
    expect(sectionLabels()).not.toContain("Data protection");
  });

  it("shows the audit log and points to Risk & retention, where retention is now set", async () => {
    const identity = new Fake([{ ...org, permissions: ["org:manage", "audit:read"] }], [exp()]);
    const { wrapper } = await setup(AdminOrganizationPage, "/admin/organizations/org-1?tab=data", identity);
    expect(wrapper.text()).toContain("Audit log");
    expect(wrapper.text()).not.toContain("How long traces are kept");
    expect(wrapper.find('input[type="number"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="retention-moved"]').text()).toContain("Risk & retention");
  });

  describe("risk & retention (ADR-102)", () => {
    const open = async (over: Partial<OrganizationDto> = {}, configure: (identity: Fake) => void = () => undefined) => {
      const identity = new Fake([{ ...org, ...over }], [exp()]);
      configure(identity);
      const { wrapper } = await setup(AdminOrganizationPage, "/admin/organizations/org-1?tab=risk", identity);
      return { identity, wrapper };
    };
    const days = (wrapper: ReturnType<typeof mount>, level: string) => wrapper.get(`input[aria-label="Retention of ${level} agents in days"]`);

    it("is a section of the Governance group, offered to who manages retention or reads governance", async () => {
      await open();
      expect(sectionLabels()).toContain("Risk & retention");
      await setup(AdminOrganizationPage, "/admin/organizations/org-1", new Fake([{ ...org, myRole: null, permissions: [] }], [exp()]));
      expect(sectionLabels()).not.toContain("Risk & retention");
    });

    it("shows one block per level with its period, the AI Act floor and the agents in it", async () => {
      const { wrapper } = await open();
      expect(wrapper.text()).toContain("cannot go below 180 days");
      for (const [level, value] of [["High", "365"], ["Limited", "90"], ["Minimal", "30"], ["Unclassified", "180"]] as Array<[string, string]>) {
        expect((days(wrapper, level).element as HTMLInputElement).value).toBe(value);
      }
      expect(wrapper.get('[data-testid="level-high"]').text()).toContain("claims-assistant");
      expect(wrapper.get('[data-testid="level-high"]').text()).toContain("Marta F.");
      expect(wrapper.get('[data-testid="level-unclassified"]').text()).toContain("rag-assistant");
      expect(wrapper.get('[data-testid="level-unclassified"]').text()).toContain("Never classified");
      expect(wrapper.get('[data-testid="level-limited"]').text()).toContain("No agents at this level");
    });

    it("saves a period only when it changed and is valid, and never below the floor", async () => {
      const { wrapper, identity } = await open();
      const save = () => wrapper.get('[data-testid="save-high"]');
      expect(save().attributes("disabled")).toBeDefined();
      type(days(wrapper, "High").element, "100"); // por debajo del suelo del AI Act
      await flushPromises();
      expect(save().attributes("disabled")).toBeDefined();
      expect(wrapper.get('[data-testid="level-high"]').text()).toContain("Choose a whole number from 180 to 365");
      type(days(wrapper, "High").element, "400");
      await flushPromises();
      expect(save().attributes("disabled")).toBeDefined();
      type(days(wrapper, "High").element, "365");
      await flushPromises();
      expect(save().attributes("disabled")).toBeDefined(); // igual que lo guardado
      type(days(wrapper, "Limited").element, "120");
      await flushPromises();
      await wrapper.get('[data-testid="save-limited"]').trigger("click");
      await flushPromises();
      expect(identity.retentionCalls).toEqual([{ level: "limited", days: 120, confirmLowering: false }]);
    });

    it("lowering a period with agents shows what would be lost and needs confirmation", async () => {
      const { wrapper, identity } = await open({}, (i) => { i.previewAgents = 1; i.previewSpans = 1200; });
      type(days(wrapper, "Minimal").element, "10");
      await flushPromises();
      await wrapper.get('[data-testid="save-minimal"]').trigger("click");
      await flushPromises();
      expect(identity.retentionCalls).toEqual([]);
      const confirm = wrapper.get('[data-testid="confirm-lowering"]');
      expect(confirm.text()).toContain("Lowering Minimal from 30 to 10 days affects 1 agent");
      expect(confirm.text()).toContain("1,200 spans");
      expect(confirm.text()).toContain("cannot be recovered");
      await wrapper.get('[data-testid="confirm-lower"]').trigger("click");
      await flushPromises();
      expect(identity.retentionCalls).toEqual([{ level: "minimal", days: 10, confirmLowering: true }]);
      expect(wrapper.find('[data-testid="confirm-lowering"]').exists()).toBe(false);
    });

    it("cancelling a lowering keeps the old period and saves nothing", async () => {
      const { wrapper, identity } = await open({}, (i) => { i.previewAgents = 1; });
      type(days(wrapper, "Minimal").element, "10");
      await flushPromises();
      await wrapper.get('[data-testid="save-minimal"]').trigger("click");
      await flushPromises();
      await button(wrapper, "Cancel")[0]!.trigger("click");
      expect((days(wrapper, "Minimal").element as HTMLInputElement).value).toBe("30");
      expect(identity.retentionCalls).toEqual([]);
    });

    it("lowering a level nobody is in saves straight away", async () => {
      const { wrapper, identity } = await open();
      type(days(wrapper, "Limited").element, "10");
      await flushPromises();
      await wrapper.get('[data-testid="save-limited"]').trigger("click");
      await flushPromises();
      expect(identity.retentionCalls).toEqual([{ level: "limited", days: 10, confirmLowering: false }]);
    });

    it("without retention:manage the periods are read-only", async () => {
      const { wrapper } = await open({ permissions: ["governance:read", "governance:manage", "org:manage"] });
      expect(wrapper.find('[data-testid="retention-readonly"]').exists()).toBe(true);
      expect(days(wrapper, "High").attributes("disabled")).toBeDefined();
      expect(wrapper.find('[data-testid="save-high"]').exists()).toBe(false);
    });

    it("without governance:manage nobody can change an agent's level", async () => {
      const { wrapper } = await open({ permissions: ["governance:read", "retention:manage", "org:manage"] });
      expect(wrapper.find('[data-testid="classify-rag-assistant"]').exists()).toBe(false);
    });

    it("an unclassified agent offers Classify and a classified one Change level", async () => {
      const { wrapper } = await open();
      expect(wrapper.get('[data-testid="classify-rag-assistant"]').text()).toBe("Classify");
      expect(wrapper.get('[data-testid="classify-claims-assistant"]').text()).toBe("Change level");
    });
  });

  describe("audit log", () => {
    const entry = (id: string, over = {}) => ({ id, at: "2026-10-09T10:00:00.000Z", experimentId: "exp-1", actorUserId: "u1", actorLabel: "ana@example.com", action: "trace.view", targetType: "trace", targetId: "abc", metadata: {}, ...over });

    it("lists who did what, with a readable action and the experiment name, and never any content", async () => {
      const identity = withRetention(new Fake([org], [exp()]));
      identity.auditPage = {
        items: [
          entry("3", { action: "data.export", targetType: "export", targetId: "traces", metadata: { kind: "traces", rows: 1200 } }),
          entry("2", { action: "retention.purge", experimentId: null, actorLabel: "system:retention", metadata: { days: 30, spans: 55 } }),
          entry("1"),
        ],
        nextCursor: null,
      };
      const { wrapper } = await setup(AdminOrganizationPage, "/admin/organizations/org-1?tab=data", identity);
      const text = wrapper.text();
      expect(text).toContain("Exported data");
      expect(text).toContain("traces, 1200 rows");
      expect(text).toContain("Deleted expired traces");
      expect(text).toContain("55 spans older than 30 days");
      expect(text).toContain("system:retention");
      expect(text).toContain("Opened a trace");
      expect(text).toContain("Support bot");
    });

    it("understands the alert and budget actions", async () => {
      const identity = withRetention(new Fake([org], [exp()]));
      identity.auditPage = {
        items: [
          entry("3", { action: "budget.update", targetType: "budget", metadata: { monthlyUsd: 250, warnPercent: 80, recipients: 1 } }),
          entry("2", { action: "alert.update", targetType: "alert", metadata: { name: "Too many errors", metric: "error_rate" } }),
          entry("1", { action: "alert.delete", targetType: "alert", metadata: { name: "Old one" } }),
        ],
        nextCursor: null,
      };
      const { wrapper } = await setup(AdminOrganizationPage, "/admin/organizations/org-1?tab=data", identity);
      const text = wrapper.text();
      expect(text).toContain("Set the cost budget");
      expect(text).toContain("$250/month, warn at 80 %");
      expect(text).toContain("Changed an alert");
      expect(text).toContain("Too many errors");
      expect(text).toContain("Deleted an alert");
      expect(text).toContain("Old one");
    });

    it("filters by action and asks the API for the older page with the cursor", async () => {
      const identity = withRetention(new Fake([org], [exp()]));
      identity.auditPage = { items: [entry("2"), entry("1")], nextCursor: "1" };
      const { wrapper } = await setup(AdminOrganizationPage, "/admin/organizations/org-1?tab=data", identity);
      expect(button(wrapper, "Show older entries")).toHaveLength(1);

      await wrapper.get('select[aria-label="Filter by action"]').setValue("data.export");
      await flushPromises();
      expect(identity.auditRequests.at(-1)).toMatchObject({ action: "data.export", cursor: undefined });

      await button(wrapper, "Show older entries")[0]!.trigger("click");
      await flushPromises();
      expect(identity.auditRequests.at(-1)).toMatchObject({ cursor: "1" });
    });

    it("says so when there is nothing to show", async () => {
      const identity = withRetention(new Fake([org], [exp()]));
      const { wrapper } = await setup(AdminOrganizationPage, "/admin/organizations/org-1?tab=data", identity);
      expect(wrapper.text()).toContain("Nothing recorded for this filter yet");
    });
  });
});

describe("Export tab (experiment)", () => {
  const technical = exp({ myRole: "technical", permissions: permissionsOf("technical") });
  const memberOrg = { ...org, myRole: null, permissions: [] };

  it("is offered to the technical profile only", async () => {
    const { wrapper } = await setup(AdminExperimentPage, "/admin/experiments/exp-1", new Fake([memberOrg], [technical]));
    expect(tabLabels(wrapper)).toContain("Export");
    const business = exp({ myRole: "business", permissions: permissionsOf("business") });
    const { wrapper: other } = await setup(AdminExperimentPage, "/admin/experiments/exp-1", new Fake([memberOrg], [business]));
    expect(tabLabels(other)).not.toContain("Export");
    const { wrapper: admin } = await setup(AdminExperimentPage, "/admin/experiments/exp-1", new Fake([org], [exp()]));
    expect(tabLabels(admin)).not.toContain("Export"); // org_admin no lee datos, tampoco los exporta
  });

  const open = async (identity: Fake) => setup(AdminExperimentPage, "/admin/experiments/exp-1?tab=export", identity);

  it("checks the export first and offers the download only when there is something to download", async () => {
    const identity = new Fake([memberOrg], [technical]);
    const { wrapper } = await open(identity);
    expect(wrapper.find("a[download]").exists()).toBe(false);
    await button(wrapper, "Prepare export")[0]!.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("12 records ready");
    const link = wrapper.get("a[download]");
    expect(link.attributes("href")).toMatch(/^\/api\/v1\/experiments\/exp-1\/export\?kind=traces&from=\d{4}-\d{2}-\d{2}T00:00:00\.000Z&to=/);
  });

  it("includes the last day: the end date is inclusive for the person and exclusive for the API", async () => {
    const identity = new Fake([memberOrg], [technical]);
    const { wrapper } = await open(identity);
    await wrapper.get('input[aria-label="From date"]').setValue("2026-10-01");
    await wrapper.get('input[aria-label="To date"]').setValue("2026-10-03");
    await button(wrapper, "Prepare export")[0]!.trigger("click");
    await flushPromises();
    expect(wrapper.get("a[download]").attributes("href")).toContain("from=2026-10-01T00:00:00.000Z&to=2026-10-04T00:00:00.000Z");
  });

  it("offers nothing to download for an empty range", async () => {
    const identity = new Fake([memberOrg], [technical]);
    identity.exportPreview = { rows: 0, maxRows: 2_000_000 };
    const { wrapper } = await open(identity);
    await button(wrapper, "Prepare export")[0]!.trigger("click");
    await flushPromises();
    expect(wrapper.find("a[download]").exists()).toBe(false);
    expect(wrapper.text()).toContain("Nothing in that range");
  });

  it("explains what is wrong with the range instead of failing silently", async () => {
    const identity = new Fake([memberOrg], [technical]);
    identity.exportPreview = new ApiError(400, "Bad Request", "Invalid export request", { to: "The range can be at most 31 days" });
    const { wrapper } = await open(identity);
    await button(wrapper, "Prepare export")[0]!.trigger("click");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe("The range can be at most 31 days");
    expect(wrapper.find("a[download]").exists()).toBe(false);
  });

  it("explains that an export is too big", async () => {
    const identity = new Fake([memberOrg], [technical]);
    identity.exportPreview = new ApiError(413, "Payload Too Large", "This export has 3000000 rows; the limit is 2000000. Choose a shorter range.");
    const { wrapper } = await open(identity);
    await button(wrapper, "Prepare export")[0]!.trigger("click");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("Choose a shorter range");
  });

  it("forgets a prepared export when the choice changes, so the link never points at another range", async () => {
    const identity = new Fake([memberOrg], [technical]);
    const { wrapper } = await open(identity);
    await button(wrapper, "Prepare export")[0]!.trigger("click");
    await flushPromises();
    expect(wrapper.find("a[download]").exists()).toBe(true);
    await wrapper.get('select[aria-label="Kind of data"]').setValue("feedback");
    await flushPromises();
    expect(wrapper.find("a[download]").exists()).toBe(false);
  });
});
