import type { ApprovalRequestDto, ApprovalRuleDto } from "@contract";

/**
 * Aprobaciones de prompts (ADR-076): cómo se presentan reglas y solicitudes a una persona. El servidor decide quién puede
 * aprobar y cuándo está aprobada; aquí solo se redactan las frases y se calculan etiquetas.
 */

type Tone = "ok" | "error" | "warn" | "info" | "neutral";
export type ApprovalAction = "publish" | "promote";

const PROFILE_LABEL: Record<string, string> = { technical: "Technical", business: "Business" };

/** `technical` → "Technical"; un perfil a medida se humaniza. */
export function profileLabel(role: string): string {
  if (PROFILE_LABEL[role]) return PROFILE_LABEL[role]!;
  const spaced = role.replace(/[._-]+/g, " ").trim();
  return spaced ? spaced[0]!.toUpperCase() + spaced.slice(1) : role;
}

/** Nombre de un paso: publicar una versión, o mover el tag de un entorno. */
export function stepLabel(action: ApprovalAction, stage: string): string {
  return action === "publish" ? "Publish a version" : `Move ${stage}`;
}

/** Los pasos que se pueden configurar, en orden: publicar y cada entorno. */
export function steps(environments: readonly string[]): Array<{ action: ApprovalAction; stage: string; label: string }> {
  return [{ action: "publish", stage: "", label: stepLabel("publish", "") }, ...environments.map((stage) => ({ action: "promote" as const, stage, label: stepLabel("promote", stage) }))];
}

export function ruleFor<R extends Pick<ApprovalRuleDto, "action" | "stage">>(rules: readonly R[], action: ApprovalAction, stage: string): R | null {
  return rules.find((r) => r.action === action && r.stage === stage) ?? null;
}

/** "1 Technical + 1 Business · always: Ana". Sin regla, "No approval needed". */
export function describeRule(rule: ApprovalRuleDto | null, names: Record<string, string> = {}): string {
  if (!rule) return "No approval needed";
  const parts = rule.requirements.map((r) => `${r.min} ${profileLabel(r.role)}`);
  const base = parts.length > 0 ? parts.join(" + ") : "";
  const always = rule.approvers.length > 0 ? `always: ${rule.approvers.map((id) => names[id] ?? "someone").join(", ")}` : "";
  return [base, always].filter(Boolean).join(" · ");
}

/** ¿Pide `candidate` menos que `floor`? Es el suelo de la organización: un experimento no puede bajarlo. */
export function belowFloor(candidate: Pick<ApprovalRuleDto, "requirements" | "approvers">, floor: ApprovalRuleDto | null): string | null {
  if (!floor) return null;
  for (const req of floor.requirements) {
    const have = candidate.requirements.find((r) => r.role === req.role)?.min ?? 0;
    if (have < req.min) return `The organization asks for ${req.min} ${profileLabel(req.role)}; this rule cannot ask for fewer.`;
  }
  if (floor.approvers.some((a) => !candidate.approvers.includes(a))) return "The organization's default approvers have to stay.";
  return null;
}

/**
 * Qué hace un agente en un paso en el que la organización tiene regla (ADR-076): seguirla (quizá con algo más), usar solo la
 * suya (exento y con regla propia) o no pedir aprobación (exento y sin regla). Son tres estados de dos datos, y se enseñan como
 * una elección para que nadie tenga que deducirlos.
 */
export type StepMode = "follow" | "own" | "none";

export const STEP_MODE_LABEL: Record<StepMode, string> = {
  follow: "Follows the organization",
  own: "Own rule · this agent only",
  none: "No approval · this agent only",
};

export function stepMode(state: { exempt: boolean; hasOwnRule: boolean }): StepMode {
  return !state.exempt ? "follow" : state.hasOwnRule ? "own" : "none";
}

/** ¿Piden lo mismo? (mismos perfiles y mínimos, mismas personas, sin importar el orden). */
export function sameRule(a: Pick<ApprovalRuleDto, "requirements" | "approvers">, b: Pick<ApprovalRuleDto, "requirements" | "approvers">): boolean {
  const reqs = (r: Pick<ApprovalRuleDto, "requirements">) => r.requirements.map((x) => `${x.role}:${x.min}`).sort().join("|");
  return reqs(a) === reqs(b) && [...a.approvers].sort().join("|") === [...b.approvers].sort().join("|");
}

export const REQUEST_STATUS: Record<ApprovalRequestDto["status"], { label: string; tone: Tone }> = {
  pending: { label: "Waiting for approval", tone: "warn" },
  approved: { label: "Approved", tone: "info" },
  executed: { label: "Done", tone: "ok" },
  rejected: { label: "Rejected", tone: "error" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
};

/** Lo que pide la solicitud, en una frase: "Publish v3" o "Move pro to v4". */
export function requestTitle(request: Pick<ApprovalRequestDto, "action" | "version" | "tag">): string {
  return request.action === "publish" ? `Publish v${request.version}` : `Move ${request.tag} to v${request.version}`;
}

/** Una línea por perfil con cuántas aprobaciones hay de las que hacen falta: "Technical 1/2". */
export function progressLines(request: Pick<ApprovalRequestDto, "evaluation">): Array<{ label: string; have: number; need: number; done: boolean }> {
  return request.evaluation.roles.map((r) => ({ label: profileLabel(r.role), have: Math.min(r.have, r.need), need: r.need, done: r.have >= r.need }));
}

/** Aprobadores obligatorios que aún no han respondido, con su nombre. */
export function waitingOn(request: Pick<ApprovalRequestDto, "evaluation" | "people">): string[] {
  return request.evaluation.missingApprovers.map((id) => request.people[id] ?? "someone");
}

/** ¿Puede esta persona decidir ahora? La respuesta final la da el servidor; esto solo evita enseñar botones que no valen. */
export function canDecideNow(request: ApprovalRequestDto, userId: string | null): boolean {
  if (!userId || request.status !== "pending" || request.requestedBy === userId) return false;
  return !request.decisions.some((d) => d.userId === userId);
}

/** Días que quedan antes de que caduque; 0 si ya pasó. */
export function daysLeft(request: Pick<ApprovalRequestDto, "expiresAt">, now: Date): number {
  return Math.max(0, Math.ceil((new Date(request.expiresAt).getTime() - now.getTime()) / 86_400_000));
}
