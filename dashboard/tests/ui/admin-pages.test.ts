import { permissionsOf } from "../permissions";
import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { defineComponent, h } from "vue";
import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { IDENTITY_API, TRACE_API } from "@/dependency-container";
import { EMPTY_THEME, type ExperimentDto, type OrganizationDto } from "@/application/identity-api";
import AdminHomePage from "@/ui/pages/admin/AdminHomePage.vue";
import AdminOrganizationPage from "@/ui/pages/admin/AdminOrganizationPage.vue";
import AdminExperimentPage from "@/ui/pages/admin/AdminExperimentPage.vue";
import { useSettingsNav, withGroupHeaders, type SettingsSection } from "@/ui/composables/useSettingsNav";
import { chooseOption, optionLabels } from "./select";
import { FakeIdentityApi, FakeTraceApi } from "../fakes";

const THEME = EMPTY_THEME;

class AdminFakeIdentityApi extends FakeIdentityApi {
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

const org: OrganizationDto = { id: "org-1", name: "Acme", myRole: "org_admin", permissions: permissionsOf("org_admin"), theme: THEME };
const exp: ExperimentDto = { id: "exp-1", organizationId: "org-1", name: "Support bot", serviceName: "support-bot", myRole: "org_admin", permissions: permissionsOf("org_admin"), organizationTheme: THEME };

async function setup(component: object, path: string, identity: FakeIdentityApi) {
  const routes = [
    { path: "/admin", name: "admin", component: { template: "<div />" } },
    { path: "/admin/members", name: "admin-members", component: { template: "<div />" } },
    { path: "/clients", name: "partner-clients", component: { template: "<div />" } },
    { path: "/assistants", name: "assistants", component: { template: "<div />" } },
    { path: "/admin/organizations/:organizationId", name: "admin-organization", component: { template: "<div />" }, props: true },
    { path: "/admin/experiments/:expId", name: "admin-experiment", component: { template: "<div />" }, props: (r: { params: Record<string, unknown> }) => ({ experimentId: r.params.expId }) },
    { path: "/e/:experimentId/conversations", name: "conversations", component: { template: "<div />" } },
  ];
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push(path);
  await router.isReady();
  const Host = defineComponent({ setup: () => () => h(QLayout, () => h(QPageContainer, () => h(component, { experimentId: exp.id, organizationId: org.id }))) });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: {
      plugins: [[Quasar, { plugins: { Dark, Notify } }], router],
      provide: { [TRACE_API as symbol]: new FakeTraceApi(), [IDENTITY_API as symbol]: identity },
    },
  });
  await flushPromises();
  return { wrapper, router };
}

describe("admin pages", () => {
  it("home lists organizations and links to the organization level", async () => {
    const identity = new AdminFakeIdentityApi([org], [exp]);
    const { wrapper, router } = await setup(AdminHomePage, "/admin", identity);
    expect(wrapper.text()).toContain("Acme");
    expect(wrapper.text()).toContain("1 experiment(s)");

    await wrapper.get("a.org-card").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("admin-organization");
    expect(router.currentRoute.value.params.organizationId).toBe("org-1");
  });

  it("experiment page opens on Connect with the env snippet for its service name", async () => {
    const identity = new AdminFakeIdentityApi([org], [exp]);
    const { wrapper } = await setup(AdminExperimentPage, "/admin/experiments/exp-1", identity);
    expect(wrapper.get('[role="tab"][aria-selected="true"]').text()).toContain("Connect");
    expect(wrapper.text()).toContain('MEMTRACE_SERVICE_NAME="support-bot"');
    expect(wrapper.text()).toContain("<your-api-key>");
  });

  it("hides the member tab from a business profile of the experiment", async () => {
    const memberExp = { ...exp, myRole: "business", permissions: permissionsOf("business") };
    const identity = new AdminFakeIdentityApi([{ ...org, myRole: null, permissions: [] }], [memberExp]);
    const { wrapper } = await setup(AdminExperimentPage, "/admin/experiments/exp-1", identity);
    // "API keys" lleva el contador pegado (0): se compara sin él
    const labels = wrapper.findAll('[role="tab"]').map((t) => t.text().replace(/\d+$/, "").trim());
    expect(labels).toEqual(["Connect", "API keys", "Score configs"]);
  });

  it("creating an experiment creates the agent: the card fields travel with it (ADR-054)", async () => {
    const identity = new AdminFakeIdentityApi([org], [exp]);
    const { wrapper } = await setup(AdminOrganizationPage, "/admin/organizations/org-1", identity);
    const newButton = wrapper.findAll("button").find((b) => b.text() === "+ New experiment")!;
    await newButton.trigger("click");
    await flushPromises();
    const dialog = document.body.querySelector("[role='dialog']")!;
    expect(dialog.textContent).toContain("An experiment is one agent");
    const type = (el: Element | null, value: string) => {
      (el as HTMLInputElement).value = value;
      el!.dispatchEvent(new Event("input"));
    };
    type(dialog.querySelector("input[placeholder^='service.name']"), "weather-assistant");
    type(dialog.querySelector("textarea"), "Answers forecasts for field teams");
    (dialog.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true }));
    await flushPromises();
    expect(identity.createdExperiments).toEqual([
      { organizationId: "org-1", name: "weather-assistant", serviceName: "weather-assistant", profile: { description: "Answers forecasts for field teams" } },
    ]);
  });

  it("organization page keeps members and appearance for org_admin only", async () => {
    const memberOrg = { ...org, myRole: null, permissions: [] };
    const identity = new AdminFakeIdentityApi([memberOrg], [exp]);
    const { wrapper } = await setup(AdminOrganizationPage, "/admin/organizations/org-1", identity);
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0); // las secciones van en el menú lateral
    expect(useSettingsNav().settingsNav.value?.sections.map((s) => s.label)).toEqual(["Experiments"]);
  });

  it("organization page offers every section in the sidebar to an org_admin and clears it on leave", async () => {
    const { wrapper } = await setup(AdminOrganizationPage, "/admin/organizations/org-1", new AdminFakeIdentityApi([org], [exp]));
    const nav = useSettingsNav().settingsNav.value!;
    expect(nav.title).toBe(org.name);
    expect(nav.sections.map((s) => s.label)).toEqual(["Experiments", "Members", "Approvals", "Data protection", "Partners", "Identity", "Appearance"]);
    expect(nav.sections.find((s) => s.id === "experiments")?.count).toBe(1);
    wrapper.unmount();
    expect(useSettingsNav().settingsNav.value).toBeNull();
  });

  describe("Identity tab (ADR-052)", () => {
    const open = async () => {
      const identity = new AdminFakeIdentityApi([org], [exp]);
      const { wrapper, router } = await setup(AdminOrganizationPage, "/admin/organizations/org-1?tab=identity", identity);
      return { identity, wrapper, router };
    };

    it("is offered to org_admin only", async () => {
      const identity = new AdminFakeIdentityApi([{ ...org, myRole: null, permissions: [] }], [exp]);
      const { wrapper } = await setup(AdminOrganizationPage, "/admin/organizations/org-1?tab=identity", identity);
      expect(wrapper.text()).not.toContain("Identity");
    });

    it("maps a provider group to a role in an experiment, and lists it", async () => {
      const { identity, wrapper } = await open();
      expect(wrapper.find("[data-testid=no-mappings]").exists()).toBe(true);
      await wrapper.get("[data-testid=mapping-group]").setValue("ai-team");
      await chooseOption(wrapper.element, "[data-testid=mapping-target]", "Support bot");
      await wrapper.get("[data-testid=add-mapping]").trigger("submit");
      await flushPromises();
      expect(identity.identity.mappings).toMatchObject([{ externalGroup: "ai-team", experimentId: "exp-1", role: "technical" }]);
      expect(wrapper.get("[data-testid=mappings]").text()).toContain("ai-team");
      expect(wrapper.get("[data-testid=mappings]").text()).toContain("Support bot");
    });

    it("offers organization roles for the whole organization and experiment roles for an experiment", async () => {
      const { wrapper } = await open();
      const roles = () => optionLabels(wrapper.element, "[data-testid=mapping-role]");
      expect(await roles()).toEqual(["org_admin"]);
      await chooseOption(wrapper.element, "[data-testid=mapping-target]", "Support bot");
      expect(await roles()).toEqual(["technical", "business"]);
    });

    it("guides the admin: hints the group id, describes the role and previews the mapping", async () => {
      const { wrapper } = await open();
      expect(wrapper.find("[data-testid=mapping-preview]").exists()).toBe(false);
      await wrapper.get("[data-testid=mapping-group]").setValue("3f2a9c1e-7b4d-4e0a-9c55-1d2e8f6a0b13");
      expect(wrapper.get("[data-testid=group-hint]").text()).toContain("Object ID");
      await wrapper.get("[data-testid=mapping-group]").setValue("AI team");
      expect(wrapper.get("[data-testid=group-hint]").text()).toContain("not the group name");
      expect(wrapper.get("[data-testid=role-description]").text()).toContain("Invites people");
      await chooseOption(wrapper.element, "[data-testid=mapping-target]", "Support bot");
      expect(wrapper.get("[data-testid=role-description]").text()).toContain("technical");
      expect(wrapper.get("[data-testid=mapping-preview]").text()).toContain("Support bot");
    });

    it("warns that SCIM is unreachable on a local or non-HTTPS address", async () => {
      const identity = new AdminFakeIdentityApi([org], [exp]);
      identity.identity.scimBaseUrl = "http://0.0.0.0:3001/api/scim/v2";
      const { wrapper } = await setup(AdminOrganizationPage, "/admin/organizations/org-1?tab=identity", identity);
      expect(wrapper.find("[data-testid=scim-warning]").exists()).toBe(true);
      const ok = await open();
      expect(ok.wrapper.find("[data-testid=scim-warning]").exists()).toBe(false);
    });

    it("removes a mapping", async () => {
      const identity = new AdminFakeIdentityApi([org], [exp]);
      await identity.createExternalMapping("org-1", { externalGroup: "sales", experimentId: "exp-1", role: "business" });
      const { wrapper } = await setup(AdminOrganizationPage, "/admin/organizations/org-1?tab=identity", identity);
      expect(wrapper.get("[data-testid=mappings]").text()).toContain("sales");
      await wrapper.get("[data-testid=remove-mapping]").trigger("click");
      await flushPromises();
      expect(identity.identity.mappings).toEqual([]);
      expect(wrapper.find("[data-testid=mappings]").exists()).toBe(false);
    });

    it("shows a SCIM token once, at creation, and can revoke it", async () => {
      const { identity, wrapper } = await open();
      expect(wrapper.get("[data-testid=scim-url]").text()).toBe("https://mt.test/api/scim/v2");
      await wrapper.get("[data-testid=create-token]").trigger("click");
      await flushPromises();
      expect(wrapper.get("[data-testid=new-token]").text()).toContain("mtscim_abcde-secret");
      expect(wrapper.get("[data-testid=tokens]").text()).toContain("mtscim_abcde");
      await wrapper.get("[data-testid=revoke-token]").trigger("click");
      await flushPromises();
      expect(identity.identity.scimTokens).toEqual([]);
    });
  });
});

describe("withGroupHeaders", () => {
  const s = (id: string, group: SettingsSection["group"]): SettingsSection => ({ id, label: id, icon: "", group });
  it("puts the group header on the first section of each group only", () => {
    const rows = withGroupHeaders([s("a", "Workspace"), s("b", "Workspace"), s("c", "Governance")]);
    expect(rows.map((r) => r.header)).toEqual(["Workspace", null, "Governance"]);
  });
});
