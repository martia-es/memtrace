import { permissionsOf } from "../permissions";
import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { defineComponent, h } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { IDENTITY_API, TRACE_API } from "@/dependency-container";
import { EMPTY_THEME, type ExperimentDto, type OrganizationDto } from "@/application/identity-api";
import AdminOrganizationPage from "@/ui/pages/admin/AdminOrganizationPage.vue";
import PartnerClientsPage from "@/ui/pages/PartnerClientsPage.vue";
import { FakeIdentityApi, FakeTraceApi } from "../fakes";

// Acceso de consultoras en el dashboard (ADR-091)

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
const exp: ExperimentDto = { id: "exp-1", organizationId: "org-1", name: "Support bot", serviceName: "support-bot", myRole: "org_admin", permissions: permissionsOf("org_admin"), organizationTheme: EMPTY_THEME };

async function setup(component: object, path: string, identity: FakeIdentityApi) {
  const routes = [
    { path: "/admin", name: "admin", component: { template: "<div />" } },
    { path: "/admin/members", name: "admin-members", component: { template: "<div />" } },
    { path: "/assistants", name: "assistants", component: { template: "<div />" } },
    { path: "/clients", name: "partner-clients", component: { template: "<div />" } },
    { path: "/admin/organizations/:organizationId", name: "admin-organization", component: { template: "<div />" }, props: true },
    { path: "/admin/experiments/:expId", name: "admin-experiment", component: { template: "<div />" } },
    { path: "/e/:experimentId/overview", name: "overview", component: { template: "<div />" } },
  ];
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push(path);
  await router.isReady();
  const Host = defineComponent({ setup: () => () => h(QLayout, () => h(QPageContainer, () => h(component, { organizationId: "org-1" }))) });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: { plugins: [[Quasar, { plugins: { Dark, Notify } }], router], provide: { [TRACE_API as symbol]: new FakeTraceApi(), [IDENTITY_API as symbol]: identity } },
  });
  await flushPromises();
  return wrapper;
}

const type = (el: Element | null | undefined, value: string) => {
  (el as HTMLInputElement).value = value;
  el!.dispatchEvent(new Event("input"));
};
const tabLabels = (wrapper: ReturnType<typeof mount>) => wrapper.findAll('[role="tab"]').map((t) => t.text().replace(/\d+$/, "").trim());
const button = (wrapper: ReturnType<typeof mount>, text: string) => wrapper.findAll("button").filter((b) => b.text() === text);

const PARTNER = "11111111-1111-4111-8111-111111111111";
const withPartner = (identity: Fake) => {
  identity.partnerships = [
    {
      id: "p-1", partnerOrganizationId: PARTNER, partnerOrganizationName: "Consulting SL", createdAt: "2026-10-01T00:00:00Z",
      grants: [{ id: "g-1", partnershipId: "p-1", userId: "u-1", userEmail: "ana@consulting.com", userName: "Ana", role: "technical", experimentId: "exp-1", createdAt: "2026-10-02T00:00:00Z" }],
    },
  ];
  return identity;
};

afterEach(() => vi.restoreAllMocks());

describe("Partners tab (client organization)", () => {
  it("is offered to org admins and to nobody else", async () => {
    expect(tabLabels(await setup(AdminOrganizationPage, "/admin/organizations/org-1", new Fake([org], [exp])))).toContain("Partners");
    const member = { ...org, myRole: null, permissions: [] };
    expect(tabLabels(await setup(AdminOrganizationPage, "/admin/organizations/org-1", new Fake([member], [exp])))).not.toContain("Partners");
  });

  it("lists each partner with who can enter, their role and where, and says exporting is never granted", async () => {
    const wrapper = await setup(AdminOrganizationPage, "/admin/organizations/org-1?tab=partners", withPartner(new Fake([org], [exp])));
    const card = wrapper.get('[data-testid="partner-p-1"]');
    expect(card.text()).toContain("Consulting SL");
    expect(card.text()).toContain("Ana");
    expect(card.text()).toContain("technical");
    expect(card.text()).toContain("Support bot");
    expect(wrapper.text()).toContain("cannot export your data");
  });

  it("adds a partner by its organization id, which gives no access by itself", async () => {
    const identity = new Fake([org], [exp]);
    const wrapper = await setup(AdminOrganizationPage, "/admin/organizations/org-1?tab=partners", identity);
    type(wrapper.get('input[aria-label="Organization id of the consultancy"]').element, PARTNER);
    await flushPromises();
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(identity.partnerCalls).toEqual([{ call: "createPartnership", args: [PARTNER] }]);
    expect(wrapper.text()).toContain("Nobody from this partner has access yet");
  });

  it("gives one person a role on the whole organization and can take it back", async () => {
    const identity = withPartner(new Fake([org], [exp]));
    const wrapper = await setup(AdminOrganizationPage, "/admin/organizations/org-1?tab=partners", identity);
    type(wrapper.get('input[aria-label="Email of the person from the partner"]').element, "luis@consulting.com");
    await flushPromises();
    await wrapper.get('[data-testid="partner-p-1"] form').trigger("submit");
    await flushPromises();
    expect(identity.partnerCalls[0]).toEqual({ call: "grantPartnerAccess", args: ["p-1", { email: "luis@consulting.com", role: "technical", experimentId: null }] });
    expect(wrapper.text()).toContain("luis@consulting.com");

    await button(wrapper, "Remove")[0]!.trigger("click");
    await flushPromises();
    expect(identity.partnerCalls[1]).toEqual({ call: "revokePartnerGrant", args: ["p-1", "g-1"] });
  });

  it("asks before ending a relationship and does nothing if the answer is no", async () => {
    const identity = withPartner(new Fake([org], [exp]));
    const wrapper = await setup(AdminOrganizationPage, "/admin/organizations/org-1?tab=partners", identity);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await button(wrapper, "End relationship")[0]!.trigger("click");
    await flushPromises();
    expect(identity.partnerCalls).toEqual([]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await button(wrapper, "End relationship")[0]!.trigger("click");
    await flushPromises();
    expect(identity.partnerCalls).toEqual([{ call: "revokePartnership", args: ["p-1"] }]);
  });
});

describe("Clients page (consultancy)", () => {
  it("lists the clients and experiments that gave access, with the role", async () => {
    const identity = new Fake([{ ...org, name: "Consulting SL", id: PARTNER }], []);
    identity.partnerClients = [{ organizationId: "org-1", organizationName: "Acme", partnershipId: "p-1", experiments: [{ id: "exp-1", name: "Support bot", role: "technical" }] }];
    const wrapper = await setup(PartnerClientsPage, "/clients", identity);
    const card = wrapper.get('[data-testid="client-org-1"]');
    expect(card.text()).toContain("Acme");
    expect(card.text()).toContain("Support bot");
    expect(card.text()).toContain("technical");
  });

  it("shows the organization id to hand to a client, and explains the empty state", async () => {
    const wrapper = await setup(PartnerClientsPage, "/clients", new Fake([{ ...org, name: "Consulting SL", id: PARTNER }], []));
    expect(wrapper.text()).toContain("No client has given you access yet");
    expect(wrapper.text()).toContain(PARTNER);
  });
});
