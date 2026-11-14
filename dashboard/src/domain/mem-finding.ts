import { tr } from "./translate";

/**
 * Presentación de un hallazgo de Mem (patrones recurrentes). El análisis devuelve una causa cruda («step | error»), una regla
 * de árbol de decisión («goal_cluster=3 > 0.5») y métricas; aquí se leen con palabras de persona. Nada de esto toca el modelo
 * guardado: es solo cómo se pinta lo que la API ya devuelve.
 */

export type FindingKind = "rate_limit" | "timeout" | "auth" | "context_length" | "silent" | "tool_error";

export interface FindingInput {
  cause: string;
  rule: string;
  decisiveStep: string;
  decisiveError: string;
  support: number;
  failures: number;
  failureRate: number;
  lift: number;
}

export interface FindingView {
  kind: FindingKind;
  /** el problema está fuera del agente (proveedor, credenciales, red): no se arregla cambiando el prompt */
  infra: boolean;
  kindLabel: string;
  title: string;
  /** qué hacer con esto, en una frase */
  hint: string;
  /** condiciones de la regla, una por chip */
  when: string[];
  /** «32 de 35 episodios …» */
  evidence: string;
  /** «3.5× más que en el resto» */
  liftText: string;
  /** el error original, limpio de espacios y sin truncar */
  rawError: string;
}

const KINDS: Array<[FindingKind, RegExp]> = [
  ["rate_limit", /rate.?limit|\b429\b|too many requests|quota/i],
  ["timeout", /time(d)?.?out|deadline exceeded|\b504\b/i],
  ["auth", /\b40[13]\b|unauthori[sz]ed|forbidden|invalid.{0,12}(api.?)?key|authentication/i],
  ["context_length", /context.?length|maximum context|token limit|too many tokens/i],
];

const INFRA = new Set<FindingKind>(["rate_limit", "timeout", "auth"]);

export function findingKind(f: Pick<FindingInput, "cause" | "decisiveError">): FindingKind {
  const error = f.decisiveError.trim() || (f.cause.includes("|") ? f.cause.split("|").slice(1).join("|") : "");
  if (!error || /^\(sin error\)$/i.test(f.cause.trim())) return "silent";
  return KINDS.find(([, re]) => re.test(error))?.[0] ?? "tool_error";
}

/** El modelo del mensaje de error, si el análisis no lo normalizó (los dígitos llegan como «N»). */
function modelOf(error: string): string | null {
  const m = /model(?:_name)?[:=]\s*['"]?([\w./-]+)/i.exec(error);
  const model = m?.[1];
  return model && !/\bN\b|-N\w/.test(model) ? model : null;
}

const clean = (s: string): string => s.replace(/\s+/g, " ").trim();

function titleOf(kind: FindingKind, f: FindingInput): string {
  const step = clean(f.decisiveStep) || (f.cause.split("|")[0] ?? "").trim();
  const model = modelOf(f.decisiveError);
  switch (kind) {
    case "rate_limit": return model ? tr("memFinding.title_rate_limit_model", { model }) : tr("memFinding.title_rate_limit");
    case "timeout": return step ? tr("memFinding.title_timeout_step", { step }) : tr("memFinding.title_timeout");
    case "auth": return tr("memFinding.title_auth");
    case "context_length": return tr("memFinding.title_context_length");
    case "silent": return tr("memFinding.title_silent");
    default: return step ? tr("memFinding.title_tool_error_step", { step }) : tr("memFinding.title_tool_error");
  }
}

/** Una condición del árbol («goal_cluster=3 > 0.5») en una frase corta. Lo que no se reconoce se humaniza sin inventar. */
export function describeClause(clause: string): string {
  const m = /^\s*([A-Za-z_]+?)(?:=([\w.-]+))?\s*(<=|>)\s*(-?[\d.]+)\s*$/.exec(clause);
  if (!m) return clean(clause);
  const [, name = "", value, op = ">", thr = "0"] = m;
  const present = op === ">" ? Number(thr) < 1 : Number(thr) >= 1;
  if (name === "goal_cluster" && value !== undefined) {
    return present ? tr("memFinding.when_goal", { group: value }) : tr("memFinding.when_not_goal", { group: value });
  }
  const label = name.replace(/_/g, " ") + (value !== undefined ? ` ${value}` : "");
  if (Number(thr) === 0.5 || Number(thr) === 0) return present ? label : tr("memFinding.when_not", { label });
  return `${label} ${op === ">" ? ">" : "≤"} ${thr}`;
}

export function whenOf(rule: string): string[] {
  const out: string[] = [];
  for (const alternative of rule.split(" | ")) {
    for (const clause of alternative.split(" AND ")) {
      const text = describeClause(clause);
      if (text && !out.includes(text)) out.push(text);
    }
  }
  return out;
}

export function presentFinding(f: FindingInput): FindingView {
  const kind = findingKind(f);
  const infra = INFRA.has(kind);
  return {
    kind,
    infra,
    kindLabel: tr(`memFinding.kind_${kind}`),
    title: titleOf(kind, f),
    hint: tr(`memFinding.hint_${kind}`),
    when: whenOf(f.rule),
    evidence: tr("memFinding.evidence", { failures: f.failures, support: f.support }),
    liftText: tr("memFinding.lift", { lift: Number(f.lift.toFixed(1)) }),
    rawError: clean(f.decisiveError || f.cause),
  };
}
