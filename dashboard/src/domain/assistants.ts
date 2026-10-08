/** Reglas de presentación del registro de asistentes (ADR-053): estado global, uptime y origen de las conexiones. Sin Vue ni HTTP. */
import type { AssistantCardDto, ConnectionDto, DeploymentSummaryDto, HealthCheckDto, HealthStatusDto, RepoConfigDto } from "@contract";

export type Tone = "ok" | "error" | "warn" | "neutral";

export const HEALTH_TONE: Record<HealthStatusDto, Tone> = { up: "ok", degraded: "warn", down: "error", unknown: "neutral" };
export const HEALTH_LABEL: Record<HealthStatusDto, string> = { up: "Up", degraded: "Degraded", down: "Down", unknown: "Unknown" };

const SEVERITY: Record<HealthStatusDto, number> = { down: 3, degraded: 2, unknown: 1, up: 0 };

export interface Headline {
  label: string;
  tone: Tone;
}

/**
 * Etiqueta global de una ficha: el peor de sus entornos. Un agente que solo está en DEV y responde está **Healthy**
 * (verde): estar o no en producción no cambia que funcione. Sin ningún despliegue (o retirado) es neutro.
 */
export function headline(card: Pick<AssistantCardDto, "deployments" | "lifecycle">): Headline {
  if (card.lifecycle === "retired") return { label: "Retired", tone: "neutral" };
  const worst = worstDeployment(card.deployments);
  if (!worst) return { label: "Not deployed", tone: "neutral" };
  if (worst.healthStatus === "down") return { label: `Down in ${worst.environment.label}`, tone: "error" };
  if (worst.healthStatus === "degraded") return { label: `Degraded in ${worst.environment.label}`, tone: "warn" };
  if (worst.healthStatus === "unknown") return { label: "Check pending", tone: "neutral" };
  return { label: "Healthy", tone: "ok" };
}

/** Aspecto de la tarjeta: `off` = todo en gris (sin desplegar o retirado); si no, el tono de su estado. */
export function cardTone(card: Pick<AssistantCardDto, "deployments" | "lifecycle">): Tone | "off" {
  if (card.lifecycle === "retired" || card.deployments.length === 0) return "off";
  return headline(card).tone;
}

/** Despliegue que resume la tarjeta: producción si lo hay; si no, el entorno más avanzado (el de mayor posición). */
export function featuredDeployment(card: Pick<AssistantCardDto, "deployments">): DeploymentSummaryDto | null {
  return productionDeployment(card) ?? [...card.deployments].sort((a, b) => b.environment.position - a.environment.position)[0] ?? null;
}

export function worstDeployment(deployments: DeploymentSummaryDto[]): DeploymentSummaryDto | null {
  let worst: DeploymentSummaryDto | null = null;
  for (const d of deployments) if (!worst || SEVERITY[d.healthStatus] > SEVERITY[worst.healthStatus]) worst = d;
  return worst;
}

/** Despliegue de producción de la ficha (el primero marcado como tal), si lo hay. */
export function productionDeployment(card: Pick<AssistantCardDto, "deployments">): DeploymentSummaryDto | null {
  return card.deployments.find((d) => d.environment.isProduction) ?? null;
}

/** Resumen de quién puede llamar al despliegue: «Everyone», «2 groups · 1 user», o que no hay nada definido. */
export function accessSummary(d: Pick<DeploymentSummaryDto, "access">): string {
  const { everyone, groups, users } = d.access;
  if (everyone) return "Everyone in the organization";
  const parts = [groups > 0 ? `${groups} ${groups === 1 ? "group" : "groups"}` : "", users > 0 ? `${users} ${users === 1 ? "user" : "users"}` : ""].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "No access defined";
}

export const AUTH_LABEL: Record<string, string> = { none: "No authentication", api_key: "API key", oauth2: "OAuth 2.0", mtls: "Mutual TLS", other: "Other" };

export function authSummary(d: Pick<DeploymentSummaryDto, "authMethod" | "authProvider">): string {
  const method = AUTH_LABEL[d.authMethod] ?? d.authMethod;
  return d.authProvider ? `${method} · ${d.authProvider}` : method;
}

export interface HealthBucket {
  /** peor estado de los sondeos del tramo; null si no hubo ninguno */
  status: HealthStatusDto | null;
}

/** Reparte los sondeos de las últimas `hours` horas en `buckets` tramos iguales, del más antiguo al más reciente. */
export function healthBuckets(checks: HealthCheckDto[], hours: number, buckets: number, nowMs: number): HealthBucket[] {
  const span = (hours * 3_600_000) / buckets;
  const start = nowMs - hours * 3_600_000;
  const out: HealthBucket[] = Array.from({ length: buckets }, () => ({ status: null }));
  for (const c of checks) {
    const index = Math.floor((Date.parse(c.checkedAt) - start) / span);
    if (index < 0 || index >= buckets) continue;
    const current = out[index]!.status;
    if (current === null || SEVERITY[c.status] > SEVERITY[current]) out[index]!.status = c.status;
  }
  return out;
}

/** Porcentaje de sondeos que no fueron `down`; null sin sondeos. */
export function uptimePercent(checks: HealthCheckDto[]): number | null {
  if (checks.length === 0) return null;
  const alive = checks.filter((c) => c.status !== "down").length;
  return (alive / checks.length) * 100;
}

export function formatUptime(percent: number | null): string {
  if (percent === null) return "–";
  return percent >= 99.95 ? "100%" : `${percent.toFixed(percent < 99 ? 1 : 2)}%`;
}

export type ConnectionOrigin = "declared-and-seen" | "seen-only" | "declared-only";

export function connectionOrigin(c: Pick<ConnectionDto, "declared" | "firstSeenAt">): ConnectionOrigin {
  if (c.declared && c.firstSeenAt) return "declared-and-seen";
  return c.declared ? "declared-only" : "seen-only";
}

export const ORIGIN_LABEL: Record<ConnectionOrigin, string> = {
  "declared-and-seen": "Declared and seen in traces",
  "seen-only": "Seen in traces, not declared",
  "declared-only": "Declared, not seen yet",
};

/** Visto en trazas y todavía sin decidir: lo que gobernanza tiene que revisar. */
export function isPendingReview(c: Pick<ConnectionDto, "firstSeenAt" | "status">): boolean {
  return c.firstSeenAt !== null && c.status === "pending";
}

export function errorRate(usage: { calls: number; errors: number } | null): number | null {
  return usage && usage.calls > 0 ? usage.errors / usage.calls : null;
}

export function initials(name: string): string {
  const words = name.split(/[\s_-]+/).filter(Boolean);
  const letters = words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : name.slice(0, 2);
  return letters.toUpperCase();
}

export interface PersonLike {
  name: string | null;
  email: string;
}

/** Cómo se nombra a una persona: su nombre, o su correo si no lo tiene. */
export function personLabel(p: PersonLike): string {
  return p.name?.trim() || p.email;
}

export function personInitials(p: PersonLike): string {
  const label = p.name?.trim();
  return label ? initials(label) : initials(p.email.split("@")[0] ?? p.email);
}

export const ROLE_LABEL: Record<string, string> = { technical: "Technical", business: "Business" };

/** Enlace al commit en el repositorio del agente, para la versión de una traza o una evaluación (ADR-065); null si no hay repo. */
export function commitUrl(repo: Pick<RepoConfigDto, "url" | "provider"> | null | undefined, sha: string): string | null {
  if (!repo) return null;
  const base = repo.url.replace(/\/+$/, "").replace(/\.git$/, "");
  return repo.provider === "bitbucket" ? `${base}/commits/${sha}` : repo.provider === "gitlab" ? `${base}/-/commit/${sha}` : `${base}/commit/${sha}`;
}

/** Frase del veredicto del gate (ADR-064) para el modal de despliegue. */
export const GATE_LABEL: Record<string, { label: string; tone: Tone }> = {
  allowed: { label: "Evaluation passed", tone: "ok" },
  rollback: { label: "Already deployed before", tone: "ok" },
  no_evaluation: { label: "Not evaluated", tone: "error" },
  evaluation_running: { label: "Evaluation running", tone: "warn" },
  only_dirty_runs: { label: "Only local evaluations", tone: "error" },
  failed: { label: "Evaluation failed", tone: "error" },
  insufficient_runs: { label: "More evaluations needed", tone: "warn" },
};

/** Frase del veredicto del gate de promoción de prompts (ADR-070). */
export const PROMPT_GATE_LABEL: Record<string, { label: string; tone: Tone }> = {
  allowed: { label: "Evaluation passed", tone: "ok" },
  rollback: { label: "Already promoted before", tone: "ok" },
  not_gated: { label: "Not protected", tone: "ok" },
  no_policy: { label: "No policy", tone: "ok" },
  policy_incomplete: { label: "Policy needs a dataset", tone: "error" },
  no_evaluation: { label: "Not evaluated", tone: "error" },
  evaluation_running: { label: "Evaluation running", tone: "warn" },
  failed: { label: "Evaluation failed", tone: "error" },
  insufficient_runs: { label: "More evaluations needed", tone: "warn" },
};

export const DEPLOY_STATUS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Deploying", tone: "warn" },
  succeeded: { label: "Deployed", tone: "ok" },
  failed: { label: "Failed", tone: "error" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/** ¿Se puede lanzar un despliegue? Hace falta repo, workflow de GitHub y rama del entorno (ADR-064). */
export function canDeploy(card: Pick<AssistantCardDto, "repo">, deployment: Pick<DeploymentSummaryDto, "deployRef">): boolean {
  return card.repo !== null && card.repo.provider === "github" && !!card.repo.deployWorkflow && !!deployment.deployRef;
}
