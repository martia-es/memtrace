import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { defineComponent, h } from "vue";
import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { ASSISTANT_API, IDENTITY_API, TRACE_API } from "@/dependency-container";
import type { ExperimentDto, OrganizationDto } from "@/application/identity-api";
import AssistantsPage from "@/ui/pages/AssistantsPage.vue";
import AssistantDetailPage from "@/ui/pages/AssistantDetailPage.vue";
import AssistantChatDock from "@/ui/components/AssistantChatDock.vue";
import { useChatDock } from "@/ui/composables/useChatDock";
import { permissionsOf } from "../permissions";
import { chooseOption } from "./select";
import { FakeAssistantApi, FakeIdentityApi, FakeTraceApi, assistantCard, connectionDto, deploymentDto } from "../fakes";

const THEME = { accentColor: null, radiusPreset: null };
const org = (role: string): OrganizationDto => ({ id: "org-1", name: "Acme", myRole: role === "org_admin" ? "org_admin" : null, permissions: permissionsOf(role), theme: THEME });
const exp = (role: string): ExperimentDto => ({ id: "exp-1", organizationId: "org-1", name: "weather", serviceName: "weather-assistant", myRole: role, permissions: permissionsOf(role), organizationTheme: THEME });

class Identity extends FakeIdentityApi {
  constructor(private orgs: OrganizationDto[], private exps: ExperimentDto[]) { super(); }
  override async listOrganizations() { return this.orgs; }
  override async listExperiments() { return this.exps; }
}

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

describe("assistants catalog (ADR-053)", () => {
  const healthy = assistantCard({ experimentId: "exp-1", name: "weather-assistant" });
  const broken = assistantCard({
    experimentId: "exp-2", name: "invoice-extractor", status: "down", description: "Reads invoices",
    deployments: [deploymentDto("dev", "up"), deploymentDto("pro", "down", { healthStatusSince: "2026-10-05T14:02:00.000Z", access: { everyone: true, groups: 0, users: 0 } })],
    connectionCounts: { mcpServers: 1, tools: 4, agents: 0, toReview: 2 },
  });

  it("shows a presentation card per assistant with its status, environments and what needs attention", async () => {
    const api = new FakeAssistantApi();
    api.catalog = [healthy, broken];
    const { wrapper } = await setup(AssistantsPage, "/assistants", api, new Identity([org("org_admin")], [exp("technical")]));
    const cards = wrapper.findAll("[data-testid^='assistant-card-']");
    expect(cards).toHaveLength(2);
    const text = wrapper.text();
    expect(text).toContain("weather-assistant");
    expect(text).toContain("Healthy");
    expect(text).toContain("Down in PRO");
    expect(text).toContain("2 to review");
    expect(text).toContain("Everyone in the organization");
    expect(text).toContain("2 groups · 1 user");
    expect(text).toContain("OAuth 2.0 · Entra ID");
    // resumen: 3 de 4 entornos arriba, 1 caído, 2 conexiones por revisar
    expect(text).toContain("3 / 4");
    expect(text).toContain("connections to review");
  });

  it("greys the whole card when nothing is deployed, and shows a green badge for an agent that is only in DEV", async () => {
    const api = new FakeAssistantApi();
    api.catalog = [
      assistantCard({ experimentId: "exp-3", name: "just-created", deployments: [], status: null, owner: null, description: "", mcpServerNames: [], connectionCounts: { mcpServers: 0, tools: 0, agents: 0, toReview: 0 } }),
      assistantCard({ experimentId: "exp-4", name: "dev-only", deployments: [deploymentDto("dev", "up")], status: "up" }),
    ];
    const { wrapper } = await setup(AssistantsPage, "/assistants", api, new Identity([org("org_admin")], []));
    const empty = wrapper.get("[data-testid='assistant-card-just-created']");
    expect(empty.attributes("data-tone")).toBe("off");
    expect(empty.get("[data-testid='status-badge']").text()).toBe("Not deployed");
    expect(empty.get("[data-testid='status-badge']").classes()).not.toContain("ok");
    expect(empty.text()).toContain("Nothing deployed yet");
    const dev = wrapper.get("[data-testid='assistant-card-dev-only']");
    expect(dev.attributes("data-tone")).toBe("ok");
    expect(dev.get("[data-testid='status-badge']").text()).toBe("Healthy");
    expect(dev.get("[data-testid='status-badge']").classes()).toContain("ok");
    expect(dev.text()).toContain("DEV · last 24 h");
  });

  it("shows the MCP servers by name, the last 24 hours as bars and who can call it", async () => {
    const api = new FakeAssistantApi();
    api.catalog = [assistantCard({ connectionCounts: { mcpServers: 3, tools: 1, agents: 0, toReview: 0 }, mcpServerNames: ["a-mcp", "b-mcp", "c-mcp"] })];
    const { wrapper } = await setup(AssistantsPage, "/assistants", api, new Identity([org("org_admin")], []));
    const text = wrapper.text();
    expect(text).toContain("a-mcp");
    expect(text).toContain("b-mcp");
    expect(text).not.toContain("c-mcp");
    expect(text).toContain("+1 MCP");
    expect(text).toContain("1 tool");
    expect(text).toContain("PRO · last 24 h");
    expect(text).toContain("100%");
    expect(wrapper.findAll(".bar")).toHaveLength(36);
    // las personas del experimento: foto si la tienen, iniciales si no
    const faces = wrapper.get("[data-testid='members']");
    const photo = faces.get("img");
    expect(photo.attributes("src")).toBe("https://photos.example/marta.png");
    expect(photo.attributes("referrerpolicy")).toBe("no-referrer");
    expect(faces.findAll("img")).toHaveLength(1);
    expect(faces.text()).toContain("LU");
    expect(faces.attributes("aria-label")).toContain("Marta Fernández (Technical)");
    expect(faces.attributes("aria-label")).toContain("luis@acme.test (Business)");
  });

  it("falls back to initials when a photo does not load, and counts the people that do not fit", async () => {
    const api = new FakeAssistantApi();
    const base = assistantCard();
    api.catalog = [assistantCard({ members: { total: 7, preview: base.members.preview } })];
    const { wrapper } = await setup(AssistantsPage, "/assistants", api, new Identity([org("org_admin")], []));
    const faces = wrapper.get("[data-testid='members']");
    expect(faces.text()).toContain("+5");
    await faces.get("img").trigger("error");
    expect(faces.find("img").exists()).toBe(false);
    expect(faces.text()).toContain("MF");
  });

  it("filters by search text and by only-with-issues", async () => {
    const api = new FakeAssistantApi();
    api.catalog = [healthy, broken];
    const { wrapper } = await setup(AssistantsPage, "/assistants", api, new Identity([org("org_admin")], []));
    await wrapper.get("input[type='checkbox']").setValue(true);
    expect(wrapper.findAll("[data-testid^='assistant-card-']").map((c) => c.attributes("data-testid"))).toEqual(["assistant-card-invoice-extractor"]);
    await wrapper.get("input[type='checkbox']").setValue(false);
    await wrapper.get("input[type=search]").setValue("weather");
    expect(wrapper.findAll("[data-testid^='assistant-card-']")).toHaveLength(1);
    expect(wrapper.text()).toContain("weather-assistant");
  });

  it("opens the assistant's card when the card is clicked", async () => {
    const api = new FakeAssistantApi();
    api.catalog = [healthy];
    const { wrapper, router } = await setup(AssistantsPage, "/assistants", api, new Identity([org("org_admin")], []));
    await wrapper.get("[data-testid='assistant-card-weather-assistant']").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("assistant");
    expect(router.currentRoute.value.params.expId).toBe("exp-1");
  });

  it("explains the missing permission instead of an empty catalog", async () => {
    const { wrapper } = await setup(AssistantsPage, "/assistants", new FakeAssistantApi(), new Identity([org("technical")], []));
    expect(wrapper.text()).toContain("No access to the catalog");
    expect(wrapper.find("[data-testid='register-assistant']").exists()).toBe(false);
  });

  it("lists every experiment as an agent with no registration step, and offers to create one", async () => {
    const api = new FakeAssistantApi();
    api.catalog = [];
    const { wrapper } = await setup(AssistantsPage, "/assistants", api, new Identity([org("org_admin")], []));
    expect(wrapper.text()).toContain("No agents yet");
    expect(wrapper.text()).toContain("Every experiment is an agent");
    expect(wrapper.text()).not.toContain("Register");
    expect(wrapper.find("[data-testid='create-agent']").exists()).toBe(true);

    const technical = await setup(AssistantsPage, "/assistants", api, new Identity([{ ...org("technical"), permissions: ["governance:read"] }], []));
    expect(technical.wrapper.find("[data-testid='create-agent']").exists()).toBe(false);
  });
});

describe("assistant detail (ADR-053)", () => {
  it("shows one card per environment and who can call the production one", async () => {
    const api = new FakeAssistantApi();
    api.grants = [{ id: "g1", deploymentId: "dep-pro", subjectType: "group", userId: null, user: null, externalGroup: "Support-Agents", memberCount: 214, source: "scim", syncedAt: "2026-10-05T10:00:00.000Z" }];
    const { wrapper } = await setup(AssistantDetailPage, "/assistants/exp-1", api, new Identity([org("org_admin")], [exp("technical")]), { experimentId: "exp-1" });
    expect(wrapper.find("[data-testid='deployment-dev']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='deployment-pro']").exists()).toBe(true);
    const access = wrapper.get("[data-testid='access-panel']").text();
    expect(access).toContain("Who can call it in PRO");
    expect(access).toContain("Support-Agents");
    expect(access).toContain("Synced by SCIM");
    expect(access).toContain("MemTrace does not enforce it");
  });

  it("shows who is in the experiment, and links to choose them only for people who can manage members", async () => {
    const withLink = await setup(AssistantDetailPage, "/assistants/exp-1", new FakeAssistantApi(), new Identity([org("org_admin")], [{ ...exp("technical"), permissions: [...permissionsOf("technical"), "member:manage"] }]), { experimentId: "exp-1" });
    const people = withLink.wrapper.get("[data-testid='people']");
    expect(people.text()).toContain("Marta Fernández Technical");
    expect(people.text()).toContain("luis@acme.test Business");
    expect(people.findAll("img")).toHaveLength(1);
    expect(withLink.wrapper.find("[data-testid='manage-people']").exists()).toBe(true);
    withLink.wrapper.unmount();

    const without = await setup(AssistantDetailPage, "/assistants/exp-1", new FakeAssistantApi(), new Identity([org("technical")], [exp("technical")]), { experimentId: "exp-1" });
    expect(without.wrapper.find("[data-testid='manage-people']").exists()).toBe(false);
    expect(without.wrapper.text()).not.toContain("Team");
  });

  it("checks a deployment's health on demand, only for people who can manage it", async () => {
    const api = new FakeAssistantApi();
    const owner = await setup(AssistantDetailPage, "/assistants/exp-1", api, new Identity([org("technical")], [exp("technical")]), { experimentId: "exp-1" });
    await owner.wrapper.get("[data-testid='deployment-pro'] [data-testid='check-now']").trigger("click");
    await flushPromises();
    expect(api.calls).toEqual([{ method: "checkDeploymentNow", args: ["exp-1", "dep-pro"] }]);
    owner.wrapper.unmount();

    const reader = await setup(AssistantDetailPage, "/assistants/exp-1", new FakeAssistantApi(), new Identity([org("governance_reader")], []), { experimentId: "exp-1" });
    expect(reader.wrapper.find("[data-testid='check-now']").exists()).toBe(false);
  });

  it("lets governance remove an access but not an owner without governance:manage", async () => {
    const grants = [{ id: "g1", deploymentId: "dep-pro", subjectType: "everyone" as const, userId: null, user: null, externalGroup: null, memberCount: null, source: "manual" as const, syncedAt: null }];
    const governed = new FakeAssistantApi();
    governed.grants = grants;
    const a = await setup(AssistantDetailPage, "/assistants/exp-1", governed, new Identity([org("org_admin")], []), { experimentId: "exp-1" });
    expect(a.wrapper.text()).toContain("Add access");
    const remove = a.wrapper.findAll("button").find((b) => b.text() === "Remove")!;
    await remove.trigger("click");
    await flushPromises();
    expect(governed.calls).toEqual([{ method: "removeGrant", args: ["exp-1", "dep-pro", "g1"] }]);
    a.wrapper.unmount();

    const owner = new FakeAssistantApi();
    owner.grants = grants;
    const b = await setup(AssistantDetailPage, "/assistants/exp-1", owner, new Identity([org("technical")], [exp("technical")]), { experimentId: "exp-1" });
    expect(b.wrapper.text()).not.toContain("Add access");
    expect(b.wrapper.findAll("button").some((x) => x.text() === "Remove")).toBe(false);
    expect(b.wrapper.text()).toContain("Edit");
  });

  it("picks a person by searching name or email, and grants access by their user id", async () => {
    const api = new FakeAssistantApi();
    api.people = [{ userId: "u-luis", name: "Luis Pérez", email: "luis@acme.test", image: "https://photos.example/luis.png" }];
    const { wrapper } = await setup(AssistantDetailPage, "/assistants/exp-1", api, new Identity([org("org_admin")], []), { experimentId: "exp-1" });
    await wrapper.findAll("button").find((b) => b.text() === "Add access")!.trigger("click");
    await flushPromises();
    const modal = new DOMWrapper(document.body);
    await chooseOption(document.body, "[data-testid='grant-type']", "One person");
    const input = modal.get("[data-testid='person-picker'] input");
    await input.setValue("luis");
    await new Promise((r) => setTimeout(r, 250));
    await flushPromises();
    expect(api.calls.find((c) => c.method === "searchPeople")?.args).toEqual(["exp-1", "luis"]);
    const option = modal.get("[data-testid='person-picker'] [role='option']");
    expect(option.text()).toContain("Luis Pérez");
    expect(option.text()).toContain("luis@acme.test");
    expect(option.find("img").attributes("src")).toBe("https://photos.example/luis.png");
    await option.trigger("mousedown");
    await modal.get("form").trigger("submit");
    await flushPromises();
    expect(api.calls.find((c) => c.method === "addGrant")?.args[2]).toMatchObject({ subjectType: "user", userId: "u-luis" });
    wrapper.unmount();
  });

  it("flags connections seen in traces and lets governance approve them", async () => {
    const api = new FakeAssistantApi();
    api.connections = [
      connectionDto({ id: "c1", name: "get_forecast" }),
      connectionDto({ id: "c2", name: "search_web", via: null, declared: false, status: "pending", usage: { calls: 37, errors: 3 } }),
      connectionDto({ id: "c3", kind: "agent", name: "geo-resolver", via: null, usage: null }),
    ];
    const { wrapper } = await setup(AssistantDetailPage, "/assistants/exp-1?tab=connections", api, new Identity([org("org_admin")], []), { experimentId: "exp-1" });
    await wrapper.setProps({});
    const { router } = { router: wrapper.vm.$router };
    await router.replace({ query: { tab: "connections" } });
    await flushPromises();
    expect(wrapper.get("[data-testid='drift-banner']").text()).toContain("search_web");
    expect(wrapper.get("[data-testid='group-agent']").text()).toContain("Not in catalog");
    const approve = wrapper.findAll("button").find((b) => b.text() === "Approve")!;
    await approve.trigger("click");
    await flushPromises();
    expect(api.calls).toEqual([{ method: "decideConnection", args: ["exp-1", "c2", "approved", null] }]);
  });
});

describe("chat with an agent (ADR-055)", () => {
  const chat = { path: "/api/chat", requestField: "message", responseField: "reply", sessionField: "session_id" };
  const open = (key: string) => deploymentDto(key, "up", { authMethod: "none" });
  const owner = () => new Identity([org("technical")], [exp("technical")]);

  it("offers Talk on every environment of an agent that declares a chat path, showing the final URL", async () => {
    const api = new FakeAssistantApi();
    api.card = assistantCard({ chat, deployments: [open("dev"), open("pro")] });
    const { wrapper } = await setup(AssistantDetailPage, "/assistants/exp-1", api, owner(), { experimentId: "exp-1" });
    expect(wrapper.findAll("[data-testid='talk']")).toHaveLength(2);
    expect(wrapper.get("[data-testid='deployment-pro']").text()).toContain("/api/chat");
  });

  it("hides Talk when the agent has no chat path or the deployment needs credentials", async () => {
    const none = await setup(AssistantDetailPage, "/assistants/exp-1", new FakeAssistantApi(), owner(), { experimentId: "exp-1" });
    expect(none.wrapper.find("[data-testid='talk']").exists()).toBe(false);
    none.wrapper.unmount();

    const api = new FakeAssistantApi();
    api.card = assistantCard({ chat, deployments: [deploymentDto("dev", "up", { authMethod: "oauth2" }), open("pro")] });
    const mixed = await setup(AssistantDetailPage, "/assistants/exp-1", api, owner(), { experimentId: "exp-1" });
    expect(mixed.wrapper.findAll("[data-testid='talk']")).toHaveLength(1);
  });

  it("opens the dock from Talk and sends messages to that environment, keeping the session", async () => {
    const api = new FakeAssistantApi();
    api.card = assistantCard({ chat, deployments: [open("dev"), open("pro")] });
    useChatDock().close();
    const { wrapper } = await setup(AssistantDetailPage, "/assistants/exp-1", api, owner(), { experimentId: "exp-1" });
    const dock = await setup(AssistantChatDock, "/assistants/exp-1", api, owner());
    await wrapper.get("[data-testid='deployment-pro'] [data-testid='talk']").trigger("click");
    await flushPromises();
    expect(dock.wrapper.get("[data-testid='chat-dock']").text()).toContain("PRO");

    for (const text of ["Rain in Valencia?", "And tomorrow?"]) {
      await dock.wrapper.get("[data-testid='chat-input']").setValue(text);
      await dock.wrapper.get("[data-testid='chat-send']").trigger("click");
      await flushPromises();
    }
    expect(api.calls.filter((c) => c.method === "chat").map((c) => c.args)).toEqual([
      ["exp-1", "dep-pro", "Rain in Valencia?", null],
      ["exp-1", "dep-pro", "And tomorrow?", "s-1"],
    ]);
    expect(dock.wrapper.text()).toContain("Sunny, 21 °C");

    await dock.wrapper.get("[data-testid='chat-close']").trigger("click");
    expect(dock.wrapper.find("[data-testid='chat-dock']").exists()).toBe(false);
  });

  it("shows an agent failure as an error bubble instead of a reply", async () => {
    const api = new FakeAssistantApi();
    api.chatReply = new Error("The agent did not respond: Connection refused");
    useChatDock().open({ experimentId: "exp-1", deploymentId: "dep-dev", agentName: "weather-assistant", environmentLabel: "DEV" });
    const dock = await setup(AssistantChatDock, "/assistants/exp-1", api, owner());
    await dock.wrapper.get("[data-testid='chat-input']").setValue("hola");
    await dock.wrapper.get("[data-testid='chat-send']").trigger("click");
    await flushPromises();
    expect(dock.wrapper.find(".msg.error").text()).toContain("Connection refused");
    useChatDock().close();
  });

  it("maximizes the dock into a full-screen popup and restores it", async () => {
    useChatDock().open({ experimentId: "exp-1", deploymentId: "dep-dev", agentName: "weather-assistant", environmentLabel: "DEV" });
    const dock = await setup(AssistantChatDock, "/assistants/exp-1", new FakeAssistantApi(), owner());
    expect(dock.wrapper.get("[data-testid='chat-dock']").classes()).not.toContain("max");
    await dock.wrapper.get("[data-testid='chat-maximize']").trigger("click");
    expect(dock.wrapper.get("[data-testid='chat-dock']").classes()).toContain("max");
    expect(dock.wrapper.find(".backdrop").exists()).toBe(true);
    await dock.wrapper.get("[data-testid='chat-maximize']").trigger("click");
    expect(dock.wrapper.get("[data-testid='chat-dock']").classes()).not.toContain("max");
    useChatDock().close();
  });
});
