import { describe, expect, it } from "vitest";
import {
  budgetTone,
  conditionText,
  emailedText,
  formatValue,
  gaugeFill,
  kindOf,
  metricsOf,
  needsSamples,
  parseRecipients,
  samplesLabel,
  stateOf,
  thresholdPhrase,
  windowText,
} from "@/ui/alert-format";

const rule = { enabled: true, metric: "error_rate" as const, customMetricId: null };
const status = (state: "ok" | "firing" | "no_data") => ({ state, since: "2026-10-10T10:00:00.000Z", lastValue: 9, lastCheckedAt: null, lastNotifiedAt: null });

describe("what the alerts screen says (ADR-086)", () => {
  it("writes every metric in its own unit", () => {
    expect(formatValue("error_rate", 12.54)).toBe("12.5 %");
    expect(formatValue("satisfaction", 80)).toBe("80 %");
    expect(formatValue("latency_p95", 1834.4)).toBe("1,834 ms");
    expect(formatValue("cost", 3.2)).toBe("$3.20");
    expect(formatValue("custom", 7)).toBe("7");
    expect(formatValue("cost", null)).toBe("—");
  });

  it("describes the condition in a sentence", () => {
    const r = { metric: "error_rate" as const, comparator: "above" as const, threshold: 5, windowMinutes: 15 };
    expect(conditionText(r)).toBe("Error rate above 5 % over 15 min");
    expect(thresholdPhrase(r)).toBe("Error rate above 5 %");
    expect(conditionText({ ...r, metric: "latency_p95", threshold: 2500, windowMinutes: 60 })).toBe("Latency (p95) above 2,500 ms over 1 hour");
    expect(conditionText({ ...r, metric: "satisfaction", comparator: "below", threshold: 70, windowMinutes: 1440 })).toBe("User satisfaction below 70 % over 24 hours");
  });

  it("names a custom chart, or falls back when it is not known", () => {
    const r = { metric: "custom" as const, comparator: "above" as const, threshold: 3, windowMinutes: 30 };
    expect(conditionText(r, "Guardrail hits")).toBe("Guardrail hits above 3 over 30 min");
    expect(conditionText(r)).toBe("Custom chart above 3 over 30 min");
  });

  it("windows read naturally", () => {
    expect(windowText(5)).toBe("5 min");
    expect(windowText(60)).toBe("1 hour");
    expect(windowText(180)).toBe("3 hours");
    expect(windowText(90)).toBe("90 min");
  });

  describe("the state of a rule", () => {
    it("says why there is nothing to report", () => {
      expect(stateOf({ ...rule, enabled: false }, status("firing"))).toEqual({ label: "Paused", tone: "neutral" });
      expect(stateOf({ ...rule, metric: "custom" }, status("ok"))).toEqual({ label: "Chart deleted", tone: "warn" });
      expect(stateOf(rule, null)).toEqual({ label: "Waiting for first check", tone: "neutral" });
    });

    it("shows what the evaluator found", () => {
      expect(stateOf(rule, status("firing"))).toEqual({ label: "Firing", tone: "error" });
      expect(stateOf(rule, status("ok"))).toEqual({ label: "OK", tone: "ok" });
      expect(stateOf(rule, status("no_data"))).toEqual({ label: "Not enough data", tone: "warn" });
    });

    it("a paused rule is never shown as firing, whatever its last state was", () => {
      expect(stateOf({ ...rule, enabled: false }, status("firing")).label).toBe("Paused");
    });
  });

  it("only some metrics need a minimum of samples, and they are counted in the right thing", () => {
    expect(needsSamples("error_rate")).toBe(true);
    expect(needsSamples("satisfaction")).toBe(true);
    expect(needsSamples("cost")).toBe(false);
    expect(needsSamples("custom")).toBe(false);
    expect(samplesLabel("satisfaction")).toBe("votes");
    expect(samplesLabel("error_rate")).toBe("conversations");
  });

  it("explains an email count, including why none went out", () => {
    expect(emailedText(3, 3)).toBe("3 emails");
    expect(emailedText(1, 1)).toBe("1 email");
    expect(emailedText(0, 0)).toBe("No recipients");
    expect(emailedText(0, 2)).toBe("Not emailed");
    expect(emailedText(0, null)).toBe("Not emailed");
  });

  it("reads addresses separated by lines, commas, semicolons or spaces", () => {
    expect(parseRecipients("a@x.io\nb@x.io, c@x.io;d@x.io  e@x.io")).toEqual(["a@x.io", "b@x.io", "c@x.io", "d@x.io", "e@x.io"]);
    expect(parseRecipients("  \n ")).toEqual([]);
  });

  it("colors the budget bar by how close it is", () => {
    expect(budgetTone(40, 80)).toBe("ok");
    expect(budgetTone(80, 80)).toBe("warn");
    expect(budgetTone(99.9, 80)).toBe("warn");
    expect(budgetTone(100, 80)).toBe("error");
    expect(budgetTone(250, 80)).toBe("error");
  });
});

describe("gaugeFill", () => {
  it("puts the limit at 66 % of the bar and never draws outside it", () => {
    expect(gaugeFill(5, 5)).toBe(66);
    expect(gaugeFill(2.5, 5)).toBe(33);
    expect(gaugeFill(40, 1)).toBe(100);
    expect(gaugeFill(0, 5)).toBe(0);
  });
  it("draws nothing without a value, and copes with a zero limit", () => {
    expect(gaugeFill(null, 5)).toBeNull();
    expect(gaugeFill(3, 0)).toBe(100);
    expect(gaugeFill(0, 0)).toBe(0);
  });
});

describe("security and evaluation rules (ADR-086, 2026-10-25)", () => {
  it("writes counts, scores, drops and days", () => {
    expect(formatValue("security_detections", 3.4)).toBe("3");
    expect(formatValue("eval_score", 91.26)).toBe("91.3 %");
    expect(formatValue("eval_score", 17, { mode: "drop" })).toBe("17 points");
    expect(formatValue("eval_stale", 3)).toBe("3 days");
    expect(formatValue("eval_stale", 1)).toBe("1 day");
  });

  it("describes each kind in a sentence", () => {
    const base = { comparator: "above" as const, windowMinutes: 15 };
    expect(conditionText({ ...base, metric: "security_detections", threshold: 0, params: { detector: "secret_leak", severity: "high" } })).toBe("secret_leak detections, severity high above 0 over 15 min");
    expect(conditionText({ ...base, metric: "security_blocked", threshold: 5, windowMinutes: 60 })).toBe("Blocked tool calls above 5 over 1 hour");
    expect(conditionText({ ...base, metric: "eval_score", threshold: 5, params: { target: "redteam/", score: "", mode: "drop" } })).toBe("redteam/: any check dropped more than 5 points against the previous run");
    expect(conditionText({ ...base, metric: "eval_score", comparator: "below", threshold: 80, params: { target: "weather", score: "correctness", mode: "absolute" } })).toBe("weather: correctness below 80 % in the latest run");
    expect(conditionText({ ...base, metric: "eval_stale", threshold: 14, params: { target: "redteam/" } })).toBe("No finished run of redteam/ in more than 14 days");
  });

  it("classifies the metrics and lists the right ones per kind", () => {
    expect(kindOf("error_rate")).toBe("traffic");
    expect(kindOf("security_blocked")).toBe("security");
    expect(kindOf("eval_stale")).toBe("evaluation");
    expect(metricsOf("security").map((m) => m.value)).toEqual(["security_detections", "security_blocked"]);
    expect(metricsOf("evaluation").map((m) => m.value)).toEqual(["eval_score", "eval_stale"]);
    expect(needsSamples("eval_score")).toBe(true);
    expect(samplesLabel("eval_score")).toBe("evaluated items");
  });
});
