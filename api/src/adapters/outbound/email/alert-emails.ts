import { METRIC_LABEL } from "@/domain/alert";
import type { AlertEmail, BudgetEmail } from "@/application/ports/email-sender";

/** Escapa lo que una persona escribió (nombre de regla, de experimento) antes de ponerlo en HTML. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Sin saltos de línea ni caracteres de control: un asunto no puede abrir otra cabecera. */
function oneLine(text: string, max = 120): string {
  return text.replace(new RegExp("[\\u0000-\\u001f\\u007f\\u2028\\u2029]+", "g"), " ").trim().slice(0, max);
}

/** Solo enlaces http(s): el enlace sale de la configuración del servidor, pero el HTML no debe poder abrir `javascript:`. */
function safeLink(link: string): string {
  return /^https?:\/\//i.test(link) ? link : "#";
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const COMPARATOR_TEXT = { above: "above", below: "below" } as const;

const WRAP = (body: string) =>
  `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#1c1f23;max-width:560px">${body}<p style="margin-top:24px;color:#6b7280;font-size:12px">This is an automatic message from MemTrace. It contains no conversation content.</p></div>`;

export function alertEmailContent(p: AlertEmail): { subject: string; html: string; text: string } {
  const headline = p.kind === "resolved" ? "is back to normal" : p.kind === "reminder" ? "is still firing" : "fired";
  const subject = `[MemTrace] ${p.kind === "resolved" ? "Resolved" : p.kind === "reminder" ? "Still firing" : "Alert"}: ${oneLine(p.ruleName)} · ${oneLine(p.experimentName)}`;
  const rule = `${METRIC_LABEL[p.metric]} ${COMPARATOR_TEXT[p.comparator]} ${p.thresholdText} (last ${p.windowMinutes} min)`;
  const html = WRAP(
    `<p>The alert <strong>${escapeHtml(p.ruleName)}</strong> on <strong>${escapeHtml(p.experimentName)}</strong> ${headline}.</p>
<table style="border-collapse:collapse;font-size:14px">
<tr><td style="padding:4px 12px 4px 0;color:#6b7280">Rule</td><td>${escapeHtml(rule)}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#6b7280">Now</td><td><strong>${escapeHtml(p.valueText)}</strong></td></tr>
</table>
<p style="margin-top:16px"><a href="${escapeHtml(safeLink(p.link))}">Open the alerts of ${escapeHtml(p.experimentName)} in MemTrace</a></p>`,
  );
  const text = `The alert "${p.ruleName}" on ${p.experimentName} ${headline}.\nRule: ${rule}\nNow: ${p.valueText}\n${safeLink(p.link)}`;
  return { subject, html, text };
}

export function budgetEmailContent(p: BudgetEmail): { subject: string; html: string; text: string } {
  const title =
    p.level === "exceeded" ? "has exceeded its monthly cost budget" : p.level === "warning" ? "is close to its monthly cost budget" : "is on track to exceed its monthly cost budget";
  const subject = `[MemTrace] Cost budget ${p.level === "exceeded" ? "exceeded" : p.level === "warning" ? "warning" : "forecast"}: ${oneLine(p.experimentName)}`;
  const projected = p.projectedUsd === null ? "" : `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">Forecast for the month</td><td>${escapeHtml(usd(p.projectedUsd))}</td></tr>`;
  const html = WRAP(
    `<p><strong>${escapeHtml(p.experimentName)}</strong> ${title}.</p>
<table style="border-collapse:collapse;font-size:14px">
<tr><td style="padding:4px 12px 4px 0;color:#6b7280">Spent this month</td><td><strong>${escapeHtml(usd(p.spentUsd))}</strong> (${Math.round(p.percent)} %)</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#6b7280">Budget</td><td>${escapeHtml(usd(p.budgetUsd))}</td></tr>
${projected}
</table>
<p style="margin-top:12px;color:#6b7280;font-size:12px">The cost is an estimate from the price catalog; models without a price count as zero.</p>
<p style="margin-top:16px"><a href="${escapeHtml(safeLink(p.link))}">Open the alerts of ${escapeHtml(p.experimentName)} in MemTrace</a></p>`,
  );
  const text = `${p.experimentName} ${title}.\nSpent this month: ${usd(p.spentUsd)} (${Math.round(p.percent)} %) of ${usd(p.budgetUsd)}${p.projectedUsd === null ? "" : `\nForecast for the month: ${usd(p.projectedUsd)}`}\n${safeLink(p.link)}`;
  return { subject, html, text };
}
