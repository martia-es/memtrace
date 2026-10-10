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

const tabLabels = (wrapper: ReturnType<typeof mount>) => wrapper.findAll('[role="tab"]').map((t) => t.text().replace(/\d+$/, "").trim());
const type = (el: Element | null | undefined, value: string) => {
  (el as HTMLInputElement).value = value;
  el!.dispatchEvent(new Event("input"));
};
const button = (wrapper: ReturnType<typeof mount>, text: string) => wrapper.findAll("button").filter((b) => b.text() === text);

function withRetention(identity: Fake) {
  identity.retention = {
    organizationId: "org-1", defaultDays: 90, minDays: 1, maxDays: 365,
    experiments: [
      { experimentId: "exp-1", name: "Support bot", serviceName: "support-bot", overrideDays: null, effectiveDays: 90 },
      { experimentId: "exp-2", name: "Sensitive bot", serviceName: "sensitive-bot", overrideDays: 7, effectiveDays: 7 },
    ],
  };
  return identity;
}

describe("Data protection tab (organization)", () => {
  it("is offered to people who can manage retention or read the audit log, and to nobody else", async () => {
    const { wrapper } = await setup(AdminOrganizationPage, "/admin/organizations/org-1", new Fake([org], [exp()]));
    expect(tabLabels(wrapper)).toContain("Data protection");

    const member = { ...org, myRole: null, permissions: [] };
    const { wrapper: other } = await setup(AdminOrganizationPage, "/admin/organizations/org-1", new Fake([member], [exp()]));
    expect(tabLabels(other)).not.toContain("Data protection");
  });

  it("shows the audit log without the retention panel when only audit:read is granted", async () => {
    const identity = new Fake([{ ...org, permissions: ["org:manage", "audit:read"] }], [exp()]);
    const { wrapper } = await setup(AdminOrganizationPage, "/admin/organizations/org-1?tab=data", identity);
    expect(wrapper.text()).toContain("Audit log");
    expect(wrapper.text()).not.toContain("How long traces are kept");
  });

  describe("retention", () => {
    const open = async () => {
      const identity = withRetention(new Fake([org], [exp()]));
      const { wrapper } = await setup(AdminOrganizationPage, "/admin/organizations/org-1?tab=data", identity);
      return { identity, wrapper };
    };

    it("shows the organization default and the effective period of every experiment", async () => {
      const { wrapper } = await open();
      expect(wrapper.text()).toContain("How long traces are kept");
      expect((wrapper.get('input[aria-label="Organization retention in days"]').element as HTMLInputElement).value).toBe("90");
      const rows = wrapper.findAll("tbody tr").filter((r) => r.text().includes("bot"));
      expect(rows[0]!.text()).toContain("90 days");
      expect(rows[1]!.text()).toContain("7 days");
    });

    it("says that the dashboard can show up to a year, and that older data no longer exists", async () => {
      const { wrapper } = await open();
      expect(wrapper.text()).toContain("can show up to a year");
    });

    it("saves a new organization period only when it changed and is valid", async () => {
      const { wrapper, identity } = await open();
      const save = () => button(wrapper, "Save")[0]!;
      expect(save().attributes("disabled")).toBeDefined();
      const input = wrapper.get('input[aria-label="Organization retention in days"]');
      type(input.element, "0");
      await flushPromises();
      expect(save().attributes("disabled")).toBeDefined();
      expect(wrapper.text()).toContain("Choose a whole number from 1 to 365");
      type(input.element, "400");
      await flushPromises();
      expect(save().attributes("disabled")).toBeDefined();
      type(input.element, "60");
      await flushPromises();
      expect(save().attributes("disabled")).toBeUndefined();
      await save().trigger("click");
      await flushPromises();
      expect(identity.retentionCalls).toEqual([{ scope: "organization", id: "org-1", days: 60 }]);
    });

    it("warns, before saving, that a shorter organization period replaces longer own periods", async () => {
      const identity = withRetention(new Fake([org], [exp()]));
      identity.retention.experiments[1]!.overrideDays = 60;
      identity.retention.experiments[1]!.effectiveDays = 60;
      const { wrapper } = await setup(AdminOrganizationPage, "/admin/organizations/org-1?tab=data", identity);
      type(wrapper.get('input[aria-label="Organization retention in days"]').element, "30");
      await flushPromises();
      expect(wrapper.text()).toContain("1 experiment with a longer own period will use this one instead");
    });

    it("sets an own period for an experiment, within the organization's, and goes back to the default", async () => {
      const { wrapper, identity } = await open();
      const input = wrapper.get('input[aria-label="Own retention of Support bot in days"]');
      type(input.element, "120"); // más largo que la organización: no se puede
      await flushPromises();
      const rowSave = () => wrapper.findAll("tbody tr").find((r) => r.text().includes("Support bot"))!.findAll("button").find((b) => b.text() === "Save")!;
      expect(rowSave().attributes("disabled")).toBeDefined();
      type(input.element, "14");
      await flushPromises();
      await rowSave().trigger("click");
      await flushPromises();
      expect(identity.retentionCalls).toEqual([{ scope: "experiment", id: "exp-1", days: 14 }]);

      await button(wrapper, "Use default")[1]!.trigger("click"); // el de «Sensitive bot», que tenía 7
      await flushPromises();
      expect(identity.retentionCalls[1]).toEqual({ scope: "experiment", id: "exp-2", days: null });
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
