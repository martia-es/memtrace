import { describe, expect, it } from "vitest";
import { alertEmailContent, budgetEmailContent, escapeHtml } from "@/adapters/outbound/email/alert-emails";
import type { AlertEmail, BudgetEmail } from "@/application/ports/email-sender";

const alert: AlertEmail = {
  to: ["ops@example.com"],
  kind: "fired",
  ruleName: "Errors up",
  experimentName: "Weather",
  metric: "error_rate",
  comparator: "above",
  windowMinutes: 15,
  valueText: "12.5 %",
  thresholdText: "5 %",
  link: "https://mt.example.com/e/exp1/alerts",
};
const budget: BudgetEmail = { to: ["fin@example.com"], level: "warning", experimentName: "Weather", budgetUsd: 100, spentUsd: 85.5, percent: 85.5, projectedUsd: 190.25, link: "https://mt.example.com/e/exp1/alerts" };

describe("alert email (ADR-086)", () => {
  it("says what happened, with the rule, the value and a link, and no conversation content", () => {
    const { subject, html, text } = alertEmailContent(alert);
    expect(subject).toBe("[MemTrace] Alert: Errors up · Weather");
    for (const body of [html, text]) {
      expect(body).toContain("Errors up");
      expect(body).toContain("Weather");
      expect(body).toContain("12.5 %");
      expect(body).toContain("Error rate above 5 % (last 15 min)");
      expect(body).toContain("https://mt.example.com/e/exp1/alerts");
    }
    expect(html).toContain("contains no conversation content");
  });

  it("words resolved and reminder messages differently", () => {
    expect(alertEmailContent({ ...alert, kind: "resolved" }).subject).toContain("Resolved:");
    expect(alertEmailContent({ ...alert, kind: "resolved" }).text).toContain("is back to normal");
    expect(alertEmailContent({ ...alert, kind: "reminder" }).subject).toContain("Still firing:");
  });

  it("escapes the names a person typed, so a rule cannot inject HTML into an email sent from MemTrace", () => {
    const { html } = alertEmailContent({ ...alert, ruleName: '<img src=x onerror="alert(1)">', experimentName: "<script>steal()</script>" });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("keeps a subject on one line, so a name with line breaks cannot add a header", () => {
    const { subject } = alertEmailContent({ ...alert, ruleName: "Bad\r\nBcc: attacker@example.com\u2028x" });
    expect(subject).not.toMatch(new RegExp("[\\r\\n\\u2028]"));
    expect(subject.length).toBeLessThan(300);
  });

  it("never links to anything but http(s)", () => {
    expect(alertEmailContent({ ...alert, link: "javascript:alert(1)" }).html).not.toContain("javascript:");
    expect(alertEmailContent({ ...alert, link: "javascript:alert(1)" }).html).toContain('href="#"');
  });

  it("escapes the quote that would break out of the link attribute", () => {
    expect(alertEmailContent({ ...alert, link: 'https://x.io/"onmouseover="evil()' }).html).not.toContain('"onmouseover=');
  });
});

describe("budget email (ADR-086)", () => {
  it("gives the spend, the budget and the forecast, and says the cost is an estimate", () => {
    const { subject, html, text } = budgetEmailContent(budget);
    expect(subject).toBe("[MemTrace] Cost budget warning: Weather");
    for (const body of [html, text]) {
      expect(body).toContain("$85.50");
      expect(body).toContain("$100.00");
      expect(body).toContain("$190.25");
    }
    expect(html).toContain("is close to its monthly cost budget");
    expect(html).toContain("estimate");
  });

  it("leaves the forecast out when there is none, and names each level", () => {
    expect(budgetEmailContent({ ...budget, projectedUsd: null }).text).not.toContain("Forecast");
    expect(budgetEmailContent({ ...budget, level: "exceeded" }).subject).toContain("exceeded");
    expect(budgetEmailContent({ ...budget, level: "exceeded" }).text).toContain("has exceeded its monthly cost budget");
    expect(budgetEmailContent({ ...budget, level: "forecast" }).subject).toContain("forecast");
  });

  it("escapes the experiment name", () => {
    expect(budgetEmailContent({ ...budget, experimentName: "<b>x</b>" }).html).not.toContain("<b>x</b>");
  });
});

describe("escapeHtml", () => {
  it("escapes the five characters that matter", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
    expect(escapeHtml("plain text")).toBe("plain text");
  });
});
