import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { computed, defineComponent, h } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { CURRENT_EXPERIMENT, IDENTITY_API, PROMPT_API, TRACE_API } from "@/dependency-container";
import { EMPTY_THEME, type CurrentUser, type ExperimentDto } from "@/application/identity-api";
import ApprovalRulesPanel from "@/ui/components/admin/ApprovalRulesPanel.vue";
import PromptDetailPage from "@/ui/pages/PromptDetailPage.vue";
import PromptsPage from "@/ui/pages/PromptsPage.vue";
import { permissionsOf } from "../permissions";
import { FakeIdentityApi, FakeTraceApi } from "../fakes";
import { FakePromptApi, approvalRequest, promptDetail, promptSummary, promptVersion } from "../fakes-prompts";
import { chooseOption } from "./select";

const exp = (role: string): ExperimentDto => ({ id: "exp-1", organizationId: "org-1", name: "weather", serviceName: "weather-assistant", myRole: role, permissions: permissionsOf(role), organizationTheme: EMPTY_THEME });

class MeIdentity extends FakeIdentityApi {
  constructor(private readonly id: string) {
    super();
  }
  override async getMe(): Promise<CurrentUser | null> {
    return { id: this.id, email: `${this.id}@x.io`, name: this.id, image: null };
  }
}

async function setup(component: object, role: string, api: FakePromptApi, props: Record<string, unknown> = {}, query = "", me = "u-me") {
  const stub = { template: "<div />" };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/e/:experimentId/prompts", name: "prompts", component: stub },
      { path: "/e/:experimentId/prompts/:promptId", name: "prompt", component: stub },
    ],
  });
  await router.push(`/e/exp-1/prompts${query}`);
  await router.isReady();
  const Host = defineComponent({ setup: () => () => h(QLayout, () => h(QPageContainer, () => h(component, props))) });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: {
      plugins: [[Quasar, { plugins: { Dark, Notify } }], router],
      provide: { [TRACE_API as symbol]: new FakeTraceApi(), [IDENTITY_API as symbol]: new MeIdentity(me), [PROMPT_API as symbol]: api, [CURRENT_EXPERIMENT as symbol]: computed(() => exp(role)) },
    },
  });
  await flushPromises();
  return { wrapper, router };
}

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.body.querySelector<T>(`[data-testid='${id}']`);
const tick = async () => flushPromises();

afterEach(() => {
  document.body.innerHTML = "";
});

describe("approval rules panel (ADR-076)", () => {
  const rule = (stage: string, mins: Array<[string, number]>, approvers: string[] = []) => ({ action: "promote" as const, stage, requirements: mins.map(([role, min]) => ({ role, min })), approvers });

  it("lists publishing and every environment, saying what each one asks for", async () => {
    const api = new FakePromptApi();
    api.rules = { ...api.rules, rules: [rule("pro", [["technical", 1], ["business", 1]], ["u-ana"])] };
    const { wrapper } = await setup(ApprovalRulesPanel, "technical", api, { scope: { type: "organization", id: "org-1" } });
    expect(wrapper.findAll("[data-testid^='rule-']").filter((n) => /^rule-(publish|promote)/.test(n.attributes("data-testid")!))).toHaveLength(4);
    expect(wrapper.find("[data-testid='rule-promote-pro'] [data-testid='rule-summary']").text()).toBe("1 Technical + 1 Business · always: Ana");
    expect(wrapper.find("[data-testid='rule-promote-dev'] [data-testid='rule-summary']").text()).toBe("No approval needed");
  });

  it("draws each step as a card with the profiles and people that have to approve", async () => {
    const api = new FakePromptApi();
    api.rules = { ...api.rules, rules: [rule("pro", [["technical", 1], ["business", 1]], ["u-ana"])] };
    const { wrapper } = await setup(ApprovalRulesPanel, "technical", api, { scope: { type: "organization", id: "org-1" } });
    const people = wrapper.findAll("[data-testid='rule-promote-pro'] .need").map((n) => n.find(".label").text());
    expect(people).toEqual(["1 Technical", "1 Business", "Ana"]);
    expect(wrapper.find("[data-testid='rule-promote-pro'] .count").text()).toBe("3 approvals");
    expect(wrapper.find("[data-testid='rule-promote-dev']").text()).toContain("No approval");
  });

  it("saves a rule per stage: the profiles, how many and the default approvers", async () => {
    const api = new FakePromptApi();
    const { wrapper } = await setup(ApprovalRulesPanel, "technical", api, { scope: { type: "organization", id: "org-1" } });
    await wrapper.find("[data-testid='rule-promote-pro'] [data-testid='rule-edit']").trigger("click");
    await wrapper.find("[data-testid='role-technical']").setValue(true);
    await wrapper.find("[data-testid='min-technical']").setValue("2");
    await wrapper.find("[data-testid='approver-u-ana']").setValue(true);
    await wrapper.find("[data-testid='rule-save']").trigger("click");
    await tick();
    const call = api.calls.find((c) => c.method === "setApprovalRule")!;
    expect(call.args[0]).toEqual({ type: "organization", id: "org-1" });
    const saved = call.args[1] as { action: string; stage: string; requirements: Array<{ role: string; min: number }>; approvers: string[] };
    expect(saved).toMatchObject({ action: "promote", stage: "pro", approvers: ["u-ana"] });
    expect(saved.requirements).toEqual(expect.arrayContaining([{ role: "business", min: 1 }, { role: "technical", min: 2 }]));
  });

  it("publishing can only be approved by technical profiles", async () => {
    const { wrapper } = await setup(ApprovalRulesPanel, "technical", new FakePromptApi(), { scope: { type: "organization", id: "org-1" } });
    await wrapper.find("[data-testid='rule-publish-publish'] [data-testid='rule-edit']").trigger("click");
    expect(wrapper.find("[data-testid='role-technical']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='role-business']").exists()).toBe(false);
  });

  it("removes a rule", async () => {
    const api = new FakePromptApi();
    api.rules = { ...api.rules, rules: [rule("pre", [["technical", 1]])] };
    const { wrapper } = await setup(ApprovalRulesPanel, "technical", api, { scope: { type: "organization", id: "org-1" } });
    await wrapper.find("[data-testid='rule-promote-pre'] [data-testid='rule-edit']").trigger("click");
    await wrapper.find("[data-testid='rule-remove']").trigger("click");
    await tick();
    expect(api.calls.find((c) => c.method === "deleteApprovalRule")?.args).toEqual([{ type: "organization", id: "org-1" }, "promote", "pre"]);
    expect(wrapper.find("[data-testid='rule-promote-pre'] [data-testid='rule-summary']").text()).toBe("No approval needed");
  });

  it("explains why an empty rule cannot be saved and points to Remove rule when there is one", async () => {
    const api = new FakePromptApi();
    const { wrapper } = await setup(ApprovalRulesPanel, "technical", api, { scope: { type: "organization", id: "org-1" } });
    await wrapper.find("[data-testid='rule-promote-pro'] [data-testid='rule-edit']").trigger("click");
    for (const input of wrapper.findAll("[data-testid^='role-']")) await input.setValue(false);
    expect((wrapper.find("[data-testid='rule-save']").element as HTMLButtonElement).disabled).toBe(true);
    expect(wrapper.find("[data-testid='rule-empty-hint']").text()).toMatch(/Remove rule|Cancel/);
    await wrapper.find("[data-testid='role-technical']").setValue(true);
    expect(wrapper.find("[data-testid='rule-empty-hint']").exists()).toBe(false);
  });

  it("an org_admin can exempt the agent from the organization's rule in a step, and then it may ask for less", async () => {
    const api = new FakePromptApi();
    api.rules = { ...api.rules, organizationRules: [rule("pro", [["technical", 2]], [])] };
    const { wrapper } = await setup(ApprovalRulesPanel, "technical", api, { scope: { type: "experiment", id: "exp-1" } });
    await wrapper.find("[data-testid='rule-promote-pro'] [data-testid='rule-edit']").trigger("click");
    await wrapper.find("[data-testid='min-technical']").setValue("1");
    expect(wrapper.find("[data-testid='rule-floor-problem']").exists()).toBe(true);
    await wrapper.find("[data-testid='rule-exempt-toggle']").setValue(true);
    await tick();
    expect(api.calls.find((c) => c.method === "setApprovalExemption")?.args).toEqual(["exp-1", "promote", "pro", true]);
    expect(wrapper.find("[data-testid='rule-promote-pro'] [data-testid='rule-exempt']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='rule-promote-pro'] [data-testid='rule-floor']").exists()).toBe(false);
    // ya sin suelo, bajar a 1 no se avisa
    await wrapper.find("[data-testid='min-technical']").setValue("1");
    expect(wrapper.find("[data-testid='rule-floor-problem']").exists()).toBe(false);
  });

  it("offers the exemption only in an experiment, and only where the organization has a rule", async () => {
    const api = new FakePromptApi();
    api.rules = { ...api.rules, organizationRules: [rule("pro", [["technical", 2]], [])] };
    const exp = await setup(ApprovalRulesPanel, "technical", api, { scope: { type: "experiment", id: "exp-1" } });
    await exp.wrapper.find("[data-testid='rule-promote-pre'] [data-testid='rule-edit']").trigger("click");
    expect(exp.wrapper.find("[data-testid='rule-exempt-toggle']").exists()).toBe(false);
    const org = await setup(ApprovalRulesPanel, "technical", new FakePromptApi(), { scope: { type: "organization", id: "org-1" } });
    await org.wrapper.find("[data-testid='rule-promote-pro'] [data-testid='rule-edit']").trigger("click");
    expect(org.wrapper.find("[data-testid='rule-exempt-toggle']").exists()).toBe(false);
  });

  it("an experiment starts from the organization's floor and cannot go below it", async () => {
    const api = new FakePromptApi();
    api.rules = { ...api.rules, organizationRules: [rule("pro", [["technical", 2]], ["u-ana"])] };
    const { wrapper } = await setup(ApprovalRulesPanel, "technical", api, { scope: { type: "experiment", id: "exp-1" } });
    expect(wrapper.find("[data-testid='rule-promote-pro'] [data-testid='rule-floor']").text()).toContain("2 Technical");
    await wrapper.find("[data-testid='rule-promote-pro'] [data-testid='rule-edit']").trigger("click");
    // arranca en el suelo
    expect((wrapper.find("[data-testid='min-technical']").element as HTMLInputElement).value).toBe("2");
    expect((wrapper.find("[data-testid='approver-u-ana']").element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.find("[data-testid='rule-floor-problem']").exists()).toBe(false);
    // bajar por debajo no se puede guardar
    await wrapper.find("[data-testid='min-technical']").setValue("1");
    expect(wrapper.find("[data-testid='rule-floor-problem']").text()).toContain("cannot ask for fewer");
    expect((wrapper.find("[data-testid='rule-save']").element as HTMLButtonElement).disabled).toBe(true);
    // endurecer sí
    await wrapper.find("[data-testid='min-technical']").setValue("3");
    expect((wrapper.find("[data-testid='rule-save']").element as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("publishing a draft behind an approval rule", () => {
  const withDraft = () => {
    const api = new FakePromptApi();
    api.detail = promptDetail({
      versions: [promptVersion(3, "Borrador", { status: "draft", publishedAt: null }), promptVersion(2, "Eres breve."), promptVersion(1, "Antiguo")],
      approvals: { publish: true, promote: [] },
    });
    return api;
  };

  it("offers Request approval instead of Publish", async () => {
    const { wrapper } = await setup(PromptDetailPage, "technical", withDraft(), { promptId: "p1" });
    await wrapper.find("[data-testid='version-3']").trigger("click");
    expect(wrapper.find("[data-testid='draft-banner']").text()).toContain("needs approval before it can be published");
    expect(wrapper.find("[data-testid='draft-publish']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='draft-request']").exists()).toBe(true);
  });

  it("without a rule the draft still publishes directly", async () => {
    const api = withDraft();
    api.detail = { ...api.detail, approvals: { publish: false, promote: [] } };
    const { wrapper } = await setup(PromptDetailPage, "technical", api, { promptId: "p1" });
    await wrapper.find("[data-testid='version-3']").trigger("click");
    expect(wrapper.find("[data-testid='draft-publish']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='draft-request']").exists()).toBe(false);
  });

  it("sends the request with a note and the people added to it, then opens the Approvals tab", async () => {
    const api = withDraft();
    api.approvals = { ...api.approvals, rules: [{ action: "publish", stage: "", requirements: [{ role: "technical", min: 1 }], approvers: [] }] };
    const { wrapper } = await setup(PromptDetailPage, "technical", api, { promptId: "p1" });
    await wrapper.find("[data-testid='version-3']").trigger("click");
    await wrapper.find("[data-testid='draft-request']").trigger("click");
    await tick();
    expect(byId("request-rule")!.textContent).toBe("1 Technical");
    const note = document.body.querySelector<HTMLTextAreaElement>("[data-testid='request-note'] textarea, textarea[data-testid='request-note']")!;
    note.value = "Fixes the 429 answer";
    note.dispatchEvent(new Event("input"));
    byId<HTMLInputElement>("extra-u-ana")!.click();
    byId("request-send")!.click();
    await tick();
    const call = api.calls.find((c) => c.method === "openApproval")!;
    expect(call.args[0]).toBe("p1");
    expect(call.args[1]).toEqual({ action: "publish", version: 3, note: "Fixes the 429 answer", extraApprovers: ["u-ana"] });
    expect(wrapper.find("[data-testid='pane-approvals']").exists()).toBe(true);
  });

  it("shows why a request was refused", async () => {
    const api = withDraft();
    api.approvalError = new Error("Nobody could approve this request");
    const { wrapper } = await setup(PromptDetailPage, "technical", api, { promptId: "p1" });
    await wrapper.find("[data-testid='version-3']").trigger("click");
    await wrapper.find("[data-testid='draft-request']").trigger("click");
    await tick();
    byId("request-send")!.click();
    await tick();
    expect(byId("request-error")!.textContent).toContain("Nobody could approve");
    expect(byId("request-modal")).not.toBeNull();
  });
});

describe("moving an environment behind an approval rule", () => {
  const gated = () => {
    const api = new FakePromptApi();
    api.detail = promptDetail({ approvals: { publish: false, promote: ["pro"] } });
    return api;
  };
  async function openTags(api: FakePromptApi) {
    const ctx = await setup(PromptDetailPage, "technical", api, { promptId: "p1" });
    await ctx.wrapper.get("[data-testid='link-release']").trigger("click");
    await flushPromises();
    return ctx;
  }

  it("asks for approval instead of moving a gated environment", async () => {
    const api = gated();
    const { wrapper } = await openTags(api);
    await chooseOption(wrapper.element, "[data-testid='env-pro'] .select-trigger", "v1 · first draft");
    expect(wrapper.find("[data-testid='move-pro']").text()).toBe("Request approval");
    await wrapper.find("[data-testid='move-pro']").trigger("click");
    await tick();
    expect(byId("request-modal")).not.toBeNull();
    expect(api.calls.some((c) => c.method === "moveTag")).toBe(false);
    byId("request-send")!.click();
    await tick();
    expect(api.calls.find((c) => c.method === "openApproval")?.args[1]).toMatchObject({ action: "promote", version: 1, tag: "pro" });
  });

  it("moves a stage without a rule directly", async () => {
    const api = gated();
    const { wrapper } = await openTags(api);
    await chooseOption(wrapper.element, "[data-testid='env-pre'] .select-trigger", "v1 · first draft");
    expect(wrapper.find("[data-testid='move-pre']").text()).toBe("Move");
    await wrapper.find("[data-testid='move-pre']").trigger("click");
    await tick();
    expect(api.calls.some((c) => c.method === "moveTag")).toBe(true);
  });

  it("going back to a version the environment already served is a rollback and moves directly", async () => {
    const api = gated();
    api.detail = promptDetail({
      approvals: { publish: false, promote: ["pro"] },
      tags: [{ tag: "pro", version: 2, updatedBy: "u1", updatedAt: "2026-10-08T10:05:00.000Z" }],
      events: [
        { id: "e2", tag: "pro", fromVersion: 1, toVersion: 2, changedBy: "u1", reason: "", createdAt: "2026-10-08T11:00:00.000Z", gateVerdict: "allowed", gateBypassed: false, bypassReason: null },
        { id: "e1", tag: "pro", fromVersion: null, toVersion: 1, changedBy: "u1", reason: "", createdAt: "2026-10-08T10:00:00.000Z", gateVerdict: "allowed", gateBypassed: false, bypassReason: null },
      ],
    });
    const { wrapper } = await openTags(api);
    await chooseOption(wrapper.element, "[data-testid='env-pro'] .select-trigger", "v1 · first draft");
    expect(wrapper.find("[data-testid='move-pro']").text()).toBe("Move");
  });
});

describe("approvals tab", () => {
  const live = (extra = {}) => approvalRequest({ requestedBy: "u-req", ...extra });
  async function openTab(api: FakePromptApi, me: string) {
    const ctx = await setup(PromptDetailPage, "technical", api, { promptId: "p1" }, "", me);
    await ctx.wrapper.find("[data-testid='pane-content']").exists();
    await ctx.wrapper.get("[data-testid='link-approvals']").trigger("click");
    await flushPromises();
    return ctx;
  }

  it("says nothing needs approval when there is no rule", async () => {
    const { wrapper } = await openTab(new FakePromptApi(), "u-me");
    expect(wrapper.find("[data-testid='no-rules']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='no-requests']").exists()).toBe(true);
  });

  it("shows what is missing and lets someone else approve with a comment", async () => {
    const api = new FakePromptApi();
    api.approvals = { ...api.approvals, requests: [live()], rules: [{ action: "promote", stage: "pro", requirements: [{ role: "technical", min: 1 }], approvers: [] }] };
    const { wrapper } = await openTab(api, "u-ana");
    expect(wrapper.find("[data-testid='request-title']").text()).toBe("Move pro to v2");
    expect(wrapper.find("[data-testid='request-progress']").text()).toContain("Technical 0/1");
    expect(wrapper.find("[data-testid='summary-promote-pro']").text()).toContain("1 Technical");
    await wrapper.find("[data-testid='comment-r1'] textarea, [data-testid='comment-r1']").setValue("looks good");
    await wrapper.find("[data-testid='approve']").trigger("click");
    await tick();
    expect(api.calls.find((c) => c.method === "decideApproval")?.args).toEqual(["r1", "approve", "looks good"]);
  });

  it("the requester cannot approve their own request but can cancel it", async () => {
    const api = new FakePromptApi();
    api.approvals = { ...api.approvals, requests: [live()] };
    const { wrapper } = await openTab(api, "u-req");
    expect(wrapper.find("[data-testid='decide']").exists()).toBe(false);
    await wrapper.find("[data-testid='cancel']").trigger("click");
    await tick();
    expect(api.calls.find((c) => c.method === "cancelApproval")?.args).toEqual(["r1"]);
  });

  it("an approved request the gate stopped explains why and can be retried by the requester", async () => {
    const api = new FakePromptApi();
    api.approvals = { ...api.approvals, requests: [live({ status: "approved", executionError: "The evaluation of v2 has not passed" })] };
    const { wrapper } = await openTab(api, "u-req");
    expect(wrapper.find("[data-testid='request-exec-error']").text()).toContain("The evaluation of v2 has not passed");
    await wrapper.find("[data-testid='retry']").trigger("click");
    await tick();
    expect(api.calls.some((c) => c.method === "executeApproval")).toBe(true);
  });

  it("adds an approver to a pending request", async () => {
    const api = new FakePromptApi();
    api.approvals = { ...api.approvals, requests: [live()] };
    const { wrapper } = await openTab(api, "u-req");
    await wrapper.find("[data-testid='add-select-r1']").setValue("u-cris");
    await wrapper.find("[data-testid='add-approver']").trigger("click");
    await tick();
    expect(api.calls.find((c) => c.method === "addApprover")?.args).toEqual(["r1", "u-cris"]);
  });
});

describe("approval inbox in the prompts list", () => {
  it("shows what is waiting for the person and links to the prompt", async () => {
    const api = new FakePromptApi();
    api.list = [promptSummary("weather-system", { latestVersion: 2 })];
    api.inbox = [approvalRequest({ id: "r9", promptId: "p9", promptName: "geo-tools" })];
    const { wrapper } = await setup(PromptsPage, "technical", api);
    const inbox = wrapper.find("[data-testid='approval-inbox']");
    expect(inbox.exists()).toBe(true);
    expect(inbox.text()).toContain("geo-tools");
    expect(inbox.text()).toContain("Move pro to v2");
    expect(inbox.find("a").attributes("href")).toContain("/e/exp-1/prompts/p9");
    expect(api.calls.find((c) => c.method === "approvalInbox")?.args).toEqual(["org-1", "exp-1"]);
  });

  it("marks the prompts that wait for the person's approval", async () => {
    const api = new FakePromptApi();
    api.list = [promptSummary("weather-system", { id: "p1", latestVersion: 2 }), promptSummary("geo-tools", { id: "p2", latestVersion: 1 })];
    api.inbox = [approvalRequest({ id: "r9", promptId: "p2", promptName: "geo-tools" })];
    const { wrapper } = await setup(PromptsPage, "business", api);
    expect(wrapper.find("[data-testid='awaiting-geo-tools']").text()).toContain("needs your approval");
    expect(wrapper.find("[data-testid='awaiting-weather-system']").exists()).toBe(false);
  });

  it("shows nothing when nothing is waiting", async () => {
    const api = new FakePromptApi();
    api.list = [promptSummary("weather-system", { latestVersion: 2 })];
    const { wrapper } = await setup(PromptsPage, "technical", api);
    expect(wrapper.find("[data-testid='approval-inbox']").exists()).toBe(false);
  });
});

