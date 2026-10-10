import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { Dark, Notify, QLayout, QPageContainer, Quasar } from "quasar";
import { computed, defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import type { AlertEventDto, AlertRuleDto, AlertsOverviewDto, BudgetViewDto } from "@contract";
import { CURRENT_EXPERIMENT, IDENTITY_API, TRACE_API } from "@/dependency-container";
import { EMPTY_THEME, type ExperimentDto, type SavedCustomMetricDto } from "@/application/identity-api";
import { ApiError } from "@/application/trace-api";
import AlertsPage from "@/ui/pages/AlertsPage.vue";
import AlertBell from "@/ui/components/AlertBell.vue";
import { permissionsOf } from "../permissions";
import { FakeIdentityApi, FakeTraceApi } from "../fakes";
import { chooseOption } from "./select";

// Pantalla de alertas, presupuesto, historial y campana (ADR-086)

const exp = (role: string): ExperimentDto => ({ id: "exp-1", organizationId: "org-1", name: "Weather", serviceName: "weather", myRole: role, permissions: permissionsOf(role), organizationTheme: EMPTY_THEME });
const rule = (over: Partial<AlertRuleDto> = {}): AlertRuleDto => ({
  id: "r1", experimentId: "exp-1", name: "Too many errors", metric: "error_rate", customMetricId: null, comparator: "above", threshold: 5, windowMinutes: 15,
  minSamples: 20, reminderMinutes: null, recipients: ["ops@example.com"], enabled: true, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", ...over,
});
const status = (state: "ok" | "firing" | "no_data", lastValue: number | null = 9) => ({ state, since: new Date(Date.now() - 3 * 60_000).toISOString(), lastValue, lastCheckedAt: null, lastNotifiedAt: null });
const event = (id: string, over: Partial<AlertEventDto> = {}): AlertEventDto => ({ id, ruleId: "r1", experimentId: "exp-1", at: new Date(Date.now() - 60_000).toISOString(), kind: "fired", value: 9, threshold: 5, emailed: 1, ...over });
const budgetView = (over: Partial<BudgetViewDto> = {}): BudgetViewDto => ({
  budget: { experimentId: "exp-1", monthlyUsd: 100, warnPercent: 80, recipients: ["fin@example.com"], enabled: true, updatedAt: "" }, month: "2026-10-01", spentUsd: 40, percent: 40, projectedUsd: 120, ...over,
});
const chart = (id: string, name: string, over: Record<string, unknown> = {}): SavedCustomMetricDto => ({
  id, name, createdAt: "", definition: { chartType: "number", stepTypes: ["guardrail"], metric: "count", metricAttribute: null, filters: [], groupByAttribute: null, ...over } as never,
});

class Api extends FakeIdentityApi {
  charts: SavedCustomMetricDto[] = [];
  override async listCustomMetrics() {
    return this.charts;
  }
}

let mounted: VueWrapper | undefined;
afterEach(() => {
  mounted?.unmount();
  document.body.innerHTML = "";
});

async function openPage(api: Api, role = "technical") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/e/:experimentId/alerts", name: "alerts", component: { template: "<div />" } },
      { path: "/", name: "home", component: { template: "<div />" } },
    ],
  });
  await router.push("/e/exp-1/alerts");
  await router.isReady();
  const Host = defineComponent({ setup: () => () => h(QLayout, () => h(QPageContainer, () => h(AlertsPage))) });
  mounted = mount(Host, {
    attachTo: document.body,
    global: { plugins: [[Quasar, { plugins: { Dark, Notify } }], router], provide: { [TRACE_API as symbol]: new FakeTraceApi(), [IDENTITY_API as symbol]: api, [CURRENT_EXPERIMENT as symbol]: computed(() => exp(role)) } },
  });
  await flushPromises();
  return mounted;
}
const q = <T extends HTMLElement = HTMLElement>(id: string) => document.body.querySelector<T>(`[data-testid='${id}']`);
const buttons = (text: string) => [...document.body.querySelectorAll("button")].filter((b) => b.textContent?.trim() === text);
const type = async (selector: string, value: string) => {
  const el = document.body.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  el.value = value;
  el.dispatchEvent(new Event("input"));
  await flushPromises();
};

describe("the alerts page", () => {
  it("lists each alert with its condition, status and current value", async () => {
    const api = new Api();
    api.alerts = {
      rules: [
        { rule: rule(), status: status("firing", 9.4) },
        { rule: rule({ id: "r2", name: "Slow answers", metric: "latency_p95", threshold: 2000, windowMinutes: 60, recipients: [] }), status: status("ok", 1400) },
        { rule: rule({ id: "r3", name: "Quiet", metric: "satisfaction", comparator: "below", threshold: 70 }), status: status("no_data", null) },
        { rule: rule({ id: "r4", name: "Off", enabled: false }), status: status("firing") },
        { rule: rule({ id: "r5", name: "New one" }), status: null },
      ],
      events: [],
      budget: null,
    };
    await openPage(api);
    const text = (id: string) => q(id)!.textContent!.replace(/\s+/g, " ");
    expect(text("rule-r1")).toContain("Too many errors");
    expect(text("rule-r1")).toContain("Error rate above 5 % over 15 min");
    expect(text("rule-r1")).toContain("Firing");
    expect(text("rule-r1")).toContain("9.4 %");
    expect(text("rule-r1")).toContain("1 address");
    expect(text("rule-r2")).toContain("Latency (p95) above 2,000 ms over 1 hour");
    expect(text("rule-r2")).toContain("1,400 ms");
    expect(text("rule-r2")).toContain("In the app only");
    expect(text("rule-r3")).toContain("Not enough data");
    expect(text("rule-r4")).toContain("Paused");
    expect(text("rule-r5")).toContain("Waiting for first check");
  });

  it("counts only the active alerts that are firing", async () => {
    const api = new Api();
    api.alerts = { rules: [{ rule: rule(), status: status("firing") }, { rule: rule({ id: "r4", enabled: false }), status: status("firing") }, { rule: rule({ id: "r6" }), status: status("ok") }], events: [], budget: null };
    await openPage(api);
    expect(q("firing-count")!.textContent).toContain("1 alert is firing right now");
    expect(q("firing-count")!.textContent).toContain("Too many errors");
  });

  it("invites the first alert, and hides the controls from someone who cannot manage alerts", async () => {
    const technical = await openPage(new Api());
    expect(q("no-alerts")!.textContent).toContain("No alerts yet");
    expect(q("new-alert")).not.toBeNull();
    technical.unmount();
    document.body.innerHTML = "";

    const api = new Api();
    api.alerts = { rules: [{ rule: rule(), status: status("ok") }], events: [], budget: budgetView() };
    await openPage(api, "business");
    expect(q("new-alert")).toBeNull();
    expect(q("set-budget")).toBeNull();
    expect(buttons("Edit")).toHaveLength(0);
    expect(buttons("Delete")).toHaveLength(0);
    expect(q("rule-r1")!.textContent).toContain("Too many errors"); // pero las ve
    expect(q("alert-rules")!.textContent).toContain("changing them needs the alert permission");
  });

  describe("creating an alert", () => {
    it("sends the rule the person described, with parsed recipients", async () => {
      const api = new Api();
      await openPage(api);
      q("new-alert")!.click();
      await flushPromises();
      await type("[aria-label='Alert name']", "  Errors up  ");
      await type("[aria-label='Threshold']", "7.5");
      await type("[aria-label='Recipients']", "Ops@Example.com\ndev@example.com, qa@example.com");
      q("alert-save")!.click();
      await flushPromises();
      expect(api.alertCalls).toEqual([
        {
          op: "create",
          body: {
            name: "Errors up", metric: "error_rate", customMetricId: null, comparator: "above", threshold: 7.5, windowMinutes: 15, minSamples: 20,
            reminderMinutes: null, recipients: ["Ops@Example.com", "dev@example.com", "qa@example.com"], enabled: true,
          },
        },
      ]);
      expect(document.body.querySelector("[role='dialog']")).toBeNull(); // se cierra al guardar
      expect(q("rule-rule-1")).not.toBeNull(); // y la lista se recarga
    });

    it("cannot be saved without a name and a number", async () => {
      await openPage(new Api());
      q("new-alert")!.click();
      await flushPromises();
      expect(q<HTMLButtonElement>("alert-save")!.disabled).toBe(true);
      await type("[aria-label='Alert name']", "x");
      expect(q<HTMLButtonElement>("alert-save")!.disabled).toBe(true);
      await type("[aria-label='Threshold']", "3");
      expect(q<HTMLButtonElement>("alert-save")!.disabled).toBe(false);
    });

    it("sends the options chosen: direction, window, reminder, minimum", async () => {
      const api = new Api();
      await openPage(api);
      q("new-alert")!.click();
      await flushPromises();
      await type("[aria-label='Alert name']", "Quality drop");
      await chooseOption(document.body, "[aria-label='Metric']", "User satisfaction");
      buttons("Falls below")[0]!.click();
      await flushPromises();
      await type("[aria-label='Threshold']", "70");
      await chooseOption(document.body, "[aria-label='Window']", "1 hour");
      await chooseOption(document.body, "[aria-label='Reminder']", "Every 6 hours");
      await type("[aria-label='Minimum samples']", "10");
      q("alert-save")!.click();
      await flushPromises();
      expect(api.alertCalls[0]!.body).toMatchObject({ metric: "satisfaction", comparator: "below", threshold: 70, windowMinutes: 60, reminderMinutes: 360, minSamples: 10 });
      expect(document.body.textContent).not.toContain("Needs at least this many conversations");
    });

    it("asks for a minimum only where it makes sense, and counts in votes for satisfaction", async () => {
      await openPage(new Api());
      q("new-alert")!.click();
      await flushPromises();
      expect(document.body.textContent).toContain("Needs at least this many conversations");
      await chooseOption(document.body, "[aria-label='Metric']", "User satisfaction");
      expect(document.body.textContent).toContain("Needs at least this many votes");
      await chooseOption(document.body, "[aria-label='Metric']", "Cost");
      expect(document.body.textContent).not.toContain("Needs at least this many");
    });

    it("a custom chart rule only offers charts that give a single number", async () => {
      const api = new Api();
      api.charts = [chart("c1", "Guardrail hits"), chart("c2", "Two steps", { stepTypes: ["a", "b"] }), chart("c3", "By country", { groupByAttribute: "country" })];
      await openPage(api);
      q("new-alert")!.click();
      await flushPromises();
      await chooseOption(document.body, "[aria-label='Metric']", "Custom chart");
      const trigger = document.body.querySelector<HTMLElement>("[aria-label='Custom chart']")!;
      trigger.click();
      await flushPromises();
      const options = [...trigger.parentElement!.querySelectorAll(".select-option")].map((o) => o.textContent!.trim());
      expect(options).toEqual(["Guardrail hits"]);
      // sin elegir una, no se puede guardar
      await type("[aria-label='Alert name']", "Chart alert");
      await type("[aria-label='Threshold']", "3");
      expect(q<HTMLButtonElement>("alert-save")!.disabled).toBe(true);
    });

    it("explains when there is no chart to use", async () => {
      await openPage(new Api());
      q("new-alert")!.click();
      await flushPromises();
      await chooseOption(document.body, "[aria-label='Metric']", "Custom chart");
      expect(document.body.textContent).toContain("You have no chart this can use yet");
    });

    it("shows which field the server refused, next to that field, and keeps the form open", async () => {
      const api = new Api();
      api.alertError = new ApiError(400, "Bad Request", "Invalid alert rule", { threshold: "Must be between 0 and 100 %", recipients: '"nope" is not a valid email address' });
      await openPage(api);
      q("new-alert")!.click();
      await flushPromises();
      await type("[aria-label='Alert name']", "Bad one");
      await type("[aria-label='Threshold']", "500");
      q("alert-save")!.click();
      await flushPromises();
      const dialog = document.body.querySelector("[role='dialog']")!;
      expect(dialog).not.toBeNull();
      const errors = [...dialog.querySelectorAll("[role='alert']")].map((e) => e.textContent);
      expect(errors).toEqual(["Must be between 0 and 100 %", '"nope" is not a valid email address']);
    });

    it("shows an error that is not about a field at the top of the form", async () => {
      const api = new Api();
      api.alertError = new ApiError(403, "Forbidden", "Missing permission: alert:manage");
      await openPage(api);
      q("new-alert")!.click();
      await flushPromises();
      await type("[aria-label='Alert name']", "x");
      await type("[aria-label='Threshold']", "3");
      q("alert-save")!.click();
      await flushPromises();
      expect(document.body.querySelector("[role='dialog'] [role='alert']")!.textContent).toContain("don't have access");
    });
  });

  it("edits an existing alert with its current values, and the Active switch pauses it", async () => {
    const api = new Api();
    api.alerts = { rules: [{ rule: rule({ reminderMinutes: 60, recipients: ["a@x.io", "b@x.io"] }), status: status("ok") }], events: [], budget: null };
    await openPage(api);
    buttons("Edit")[0]!.click();
    await flushPromises();
    expect(document.body.querySelector<HTMLInputElement>("[aria-label='Alert name']")!.value).toBe("Too many errors");
    expect(document.body.querySelector<HTMLInputElement>("[aria-label='Threshold']")!.value).toBe("5");
    expect(document.body.querySelector<HTMLTextAreaElement>("[aria-label='Recipients']")!.value).toBe("a@x.io\nb@x.io");
    expect(document.body.querySelector("[aria-label='Reminder']")!.textContent).toContain("Every hour");
    const active = document.body.querySelector<HTMLInputElement>("[role='dialog'] input[type='checkbox']")!;
    active.click();
    await flushPromises();
    q("alert-save")!.click();
    await flushPromises();
    expect(api.alertCalls[0]).toMatchObject({ op: "update", id: "r1", body: { enabled: false, reminderMinutes: 60, recipients: ["a@x.io", "b@x.io"] } });
  });

  it("deleting needs a second click, and 'Keep' cancels it", async () => {
    const api = new Api();
    api.alerts = { rules: [{ rule: rule(), status: status("ok") }], events: [], budget: null };
    await openPage(api);
    buttons("Delete")[0]!.click();
    await flushPromises();
    expect(api.alertCalls).toEqual([]);
    buttons("Keep")[0]!.click();
    await flushPromises();
    expect(buttons("Delete for good")).toHaveLength(0);
    buttons("Delete")[0]!.click();
    await flushPromises();
    q("confirm-delete")!.click();
    await flushPromises();
    expect(api.alertCalls).toEqual([{ op: "delete", id: "r1" }]);
    expect(q("rule-r1")).toBeNull();
  });

  describe("the budget", () => {
    it("invites to set one when there is none", async () => {
      await openPage(new Api());
      expect(q("no-budget")!.textContent).toContain("No budget set");
      expect(q("set-budget")!.textContent).toContain("Set a budget");
    });

    it("shows the spend, the forecast and who is emailed", async () => {
      const api = new Api();
      api.alerts = { rules: [], events: [], budget: budgetView({ spentUsd: 85.5, percent: 85.5, projectedUsd: 190.25 }) };
      await openPage(api);
      const text = q("alert-budget")!.textContent!.replace(/\s+/g, " ");
      expect(text).toContain("$85.50");
      expect(text).toContain("of $100.00 this month (86 %)");
      expect(text).toContain("Warning");
      expect(text).toContain("$190.25");
      expect(text).toContain("Emails go to 1 address");
      expect(q("alert-budget")!.querySelector("[role='progressbar']")!.getAttribute("aria-valuenow")).toBe("86");
    });

    it("says when the month is over budget, and never draws more than a full bar", async () => {
      const api = new Api();
      api.alerts = { rules: [], events: [], budget: budgetView({ spentUsd: 250, percent: 250, projectedUsd: 400 }) };
      await openPage(api);
      expect(q("alert-budget")!.textContent).toContain("Exceeded");
      expect(q("alert-budget")!.querySelector<HTMLElement>(".fill")!.style.width).toBe("100%");
    });

    it("explains the missing forecast early in the month, and a budget nobody is emailed about", async () => {
      const api = new Api();
      api.alerts = { rules: [], events: [], budget: budgetView({ projectedUsd: null, budget: { ...budgetView().budget, recipients: [] } }) };
      await openPage(api);
      expect(q("forecast")!.textContent).toContain("appears from the third day");
      expect(q("forecast")!.textContent).toContain("Nobody is emailed");
    });

    it("sets a budget with the amount, the percentage and the addresses", async () => {
      const api = new Api();
      await openPage(api);
      q("set-budget")!.click();
      await flushPromises();
      expect(q<HTMLButtonElement>("budget-save")!.disabled).toBe(true);
      await type("[aria-label='Monthly budget']", "250");
      await type("[aria-label='Warning percentage']", "70");
      await type("[aria-label='Recipients']", "fin@example.com");
      q("budget-save")!.click();
      await flushPromises();
      expect(api.alertCalls).toEqual([{ op: "setBudget", body: { monthlyUsd: 250, warnPercent: 70, recipients: ["fin@example.com"], enabled: true } }]);
      expect(q("alert-budget")!.textContent).toContain("of $250.00 this month");
    });

    it("shows the server's complaint about the amount", async () => {
      const api = new Api();
      api.alertError = new ApiError(400, "Bad Request", "Invalid budget", { warnPercent: "A whole percentage from 1 to 99" });
      await openPage(api);
      q("set-budget")!.click();
      await flushPromises();
      await type("[aria-label='Monthly budget']", "100");
      await type("[aria-label='Warning percentage']", "150");
      q("budget-save")!.click();
      await flushPromises();
      expect(document.body.querySelector("[role='dialog'] [role='alert']")!.textContent).toBe("A whole percentage from 1 to 99");
    });

    it("removes it after a confirmation", async () => {
      const api = new Api();
      api.alerts = { rules: [], events: [], budget: budgetView() };
      await openPage(api);
      buttons("Remove budget")[0]!.click();
      await flushPromises();
      expect(api.alertCalls).toEqual([]);
      q("confirm-budget-delete")!.click();
      await flushPromises();
      expect(api.alertCalls).toEqual([{ op: "deleteBudget" }]);
      expect(q("no-budget")).not.toBeNull();
    });
  });

  describe("the history", () => {
    it("lists what happened, with the alert's name and a clear event", async () => {
      const api = new Api();
      api.alerts = {
        rules: [{ rule: rule(), status: status("ok") }],
        events: [event("3", { kind: "resolved", value: 2 }), event("2", { kind: "reminder", emailed: 0 }), event("1", { ruleId: "gone", kind: "fired", emailed: 0 })],
        budget: null,
      };
      await openPage(api);
      const rows = [...q("alert-history")!.querySelectorAll("[data-testid='history-row']")].map((r) => r.textContent!.replace(/\s+/g, " ").trim());
      expect(rows[0]).toContain("Too many errors");
      expect(rows[0]).toContain("is back to normal");
      expect(rows[0]).toContain("2 % vs 5 %");
      expect(rows[1]).toContain("is still over its limit");
      expect(rows[1]).toContain("Not emailed");
      expect(rows[2]).toContain("(deleted alert)");
    });

    it("says nothing has fired yet", async () => {
      await openPage(new Api());
      expect(q("alert-history")!.textContent).toContain("Nothing has fired yet");
      expect(q("older")).toBeNull();
    });

    it("loads older pages when there are more", async () => {
      const api = new Api();
      api.alerts = { rules: [], events: Array.from({ length: 20 }, (_, i) => event(String(100 - i))), budget: null };
      api.olderEvents = { items: [event("50", { kind: "resolved" })], nextCursor: null };
      await openPage(api);
      expect(q("older")).not.toBeNull();
      q("older")!.click();
      await flushPromises();
      expect(api.alertCalls).toEqual([{ op: "events", id: "81" }]);
      expect(q("alert-history")!.querySelectorAll("[data-testid='history-row']")).toHaveLength(21);
      expect(q("older")).toBeNull();
    });
  });

  it("shows firing alerts first, and the filters narrow the list", async () => {
    const api = new Api();
    api.alerts = {
      rules: [
        { rule: rule({ id: "ok", name: "Fine" }), status: status("ok", 1) },
        { rule: rule({ id: "off", name: "Off", enabled: false }), status: null },
        { rule: rule({ id: "bad", name: "Broken" }), status: status("firing", 40) },
      ],
      events: [],
      budget: null,
    };
    await openPage(api);
    const order = () => [...document.body.querySelectorAll("[data-testid^='rule-']")].map((r) => r.getAttribute("data-testid"));
    expect(order()).toEqual(["rule-bad", "rule-ok", "rule-off"]);
    const chip = (label: string) => [...document.body.querySelectorAll<HTMLButtonElement>(".mt-chip")].find((c) => c.textContent!.trim().startsWith(label))!;
    chip("Firing").click();
    await flushPromises();
    expect(order()).toEqual(["rule-bad"]);
    chip("Healthy").click();
    await flushPromises();
    expect(order()).toEqual(["rule-ok"]);
    chip("Paused").click();
    await flushPromises();
    expect(order()).toEqual(["rule-off"]);
  });

  it("the switch pauses and resumes an alert without touching the rest of the rule", async () => {
    const api = new Api();
    api.alerts = { rules: [{ rule: rule(), status: status("ok") }], events: [], budget: null };
    await openPage(api);
    q("alert-switch")!.click();
    await flushPromises();
    expect(api.alertCalls[0]).toMatchObject({ op: "update", id: "r1", body: { enabled: false, name: "Too many errors", threshold: 5, recipients: ["ops@example.com"] } });
    expect(api.alertCalls[0]!.body).not.toHaveProperty("id");
  });

  it("hides the switch from someone who cannot manage alerts", async () => {
    const api = new Api();
    api.alerts = { rules: [{ rule: rule(), status: status("ok") }], events: [], budget: null };
    await openPage(api, "business");
    expect(q("alert-switch")).toBeNull();
  });

  it("groups the history by day", async () => {
    const api = new Api();
    api.alerts = { rules: [{ rule: rule(), status: status("ok") }], events: [event("2"), event("1", { at: new Date(Date.now() - 86_400_000).toISOString() })], budget: null };
    await openPage(api);
    const days = [...q("alert-history")!.querySelectorAll(".day-title")].map((d) => d.textContent);
    expect(days).toEqual(["Today", "Yesterday"]);
  });

  it("shows why it could not load instead of a blank page", async () => {
    const api = new Api();
    api.getAlerts = async () => {
      throw new ApiError(503, "Service Unavailable", "down");
    };
    await openPage(api);
    expect(document.body.querySelector("[role='alert']")!.textContent).toContain("not responding");
    expect(q("no-alerts")).not.toBeNull();
  });
});

describe("the bell", () => {
  async function bell(api: Api) {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: { template: "<div />" } }, { path: "/e/:experimentId/alerts", name: "alerts", component: { template: "<div />" } }] });
    await router.push("/");
    await router.isReady();
    mounted = mount(AlertBell, { attachTo: document.body, global: { plugins: [[Quasar, { plugins: { Dark, Notify } }], router], provide: { [IDENTITY_API as symbol]: api } } });
    await flushPromises();
    return { router };
  }
  const open = (over: Record<string, unknown> = {}) => ({
    ruleId: "r1", ruleName: "Too many errors", experimentId: "exp-9", experimentName: "Support bot", metric: "error_rate" as const, since: new Date(Date.now() - 5 * 60_000).toISOString(),
    lastValue: 9, threshold: 5, comparator: "above" as const, ...over,
  });

  it("shows nothing but the bell when no alert is firing", async () => {
    await bell(new Api());
    expect(q("bell-count")).toBeNull();
    expect(document.body.querySelector("[aria-label='Alerts']")).not.toBeNull();
  });

  it("counts the alerts that are firing, capped at 9+", async () => {
    const api = new Api();
    api.openAlerts = { items: [open(), open({ ruleId: "r2" })] };
    await bell(api);
    expect(q("bell-count")!.textContent).toBe("2");
    expect(document.body.querySelector("[aria-label='2 alerts firing']")).not.toBeNull();
    mounted!.unmount();
    document.body.innerHTML = "";
    const many = new Api();
    many.openAlerts = { items: Array.from({ length: 12 }, (_, i) => open({ ruleId: `r${i}` })) };
    await bell(many);
    expect(q("bell-count")!.textContent).toBe("9+");
  });

  it("lists each one with its agent, and goes to that agent's alerts when chosen", async () => {
    const api = new Api();
    api.openAlerts = { items: [open()] };
    const { router } = await bell(api);
    document.body.querySelector<HTMLElement>("[aria-label='1 alerts firing']")!.click();
    await flushPromises();
    const item = q("bell-item")!;
    expect(item.textContent).toContain("Too many errors");
    expect(item.textContent).toContain("Support bot");
    expect(item.textContent).toContain("Error rate above 5 %"); // la condición
    expect(item.textContent).toContain("9 %"); // y el valor de ahora
    item.click();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("alerts");
    expect(router.currentRoute.value.params.experimentId).toBe("exp-9");
  });

  it("has a Manage alerts shortcut to the first firing agent when no agent is open", async () => {
    const api = new Api();
    api.openAlerts = { items: [open()] };
    const { router } = await bell(api);
    document.body.querySelector<HTMLElement>("[aria-label='1 alerts firing']")!.click();
    await flushPromises();
    q("bell-manage")!.click();
    await flushPromises();
    expect(router.currentRoute.value.params.experimentId).toBe("exp-9");
  });

  it("stays quiet when the query fails", async () => {
    const api = new Api();
    api.listOpenAlerts = async () => {
      throw new Error("down");
    };
    await bell(api);
    expect(q("bell-count")).toBeNull();
  });
});
