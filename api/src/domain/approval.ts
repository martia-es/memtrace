import { ValidationError } from "./errors";

/**
 * Aprobaciones de prompts (ADR-076). Reglas puras: el servicio reúne reglas, personas y decisiones y estas funciones deciden.
 *
 * Una regla dice qué hace falta para UNA acción en UN paso: `publish` (publicar una versión) o `promote` (apuntar el tag de un
 * entorno a ella, con el entorno como paso). La organización pone el suelo; un experimento solo puede endurecerlo.
 */

export const APPROVAL_ACTIONS = ["publish", "promote"] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

export const MIN_APPROVALS = 1;
export const MAX_APPROVALS = 10;
export const MAX_REQUIREMENTS = 5;
export const MAX_RULE_APPROVERS = 10;
export const MAX_NOTE = 500;
export const REQUEST_TTL_DAYS = 7;

/** Perfiles que pueden aprobar cada acción. Publicar es una revisión del texto: solo el perfil técnico. Promover lo decide la organización. */
export const PUBLISH_APPROVER_ROLES: readonly string[] = ["technical"];

/** "Hacen falta `min` aprobaciones de personas con el perfil `role`." */
export interface ApprovalRequirement {
  role: string;
  min: number;
}

/** Lo que exige una acción en un paso. Sin requisitos ni aprobadores no habría regla (se borra). */
export interface ApprovalRule {
  action: ApprovalAction;
  /** clave del entorno de destino; vacío en `publish` */
  stage: string;
  requirements: ApprovalRequirement[];
  /** personas concretas que tienen que aprobar sí o sí */
  approvers: string[];
}

export type ApprovalScope = { type: "organization"; id: string } | { type: "experiment"; id: string };

export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled" | "expired" | "executed";

export interface ApprovalDecision {
  userId: string;
  decision: "approve" | "reject";
  comment: string;
  decidedAt: string;
}

export interface ApprovalRequest {
  id: string;
  promptId: string;
  action: ApprovalAction;
  version: number;
  /** vacío en `publish` */
  tag: string;
  note: string;
  bypassReason: string | null;
  requestedBy: string | null;
  status: ApprovalStatus;
  executionError: string | null;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  executedAt: string | null;
  /** aprobadores añadidos a esta solicitud sobre la marcha */
  extraApprovers: string[];
  decisions: ApprovalDecision[];
}

export function ruleKey(rule: Pick<ApprovalRule, "action" | "stage">): string {
  return `${rule.action}:${rule.stage}`;
}

/** Valida el paso (acción y entorno) sobre el que se actúa sin escribir una regla, p. ej. una excepción. */
export function validateStep(input: { action: unknown; stage?: unknown }, environmentKeys: readonly string[]): { action: ApprovalAction; stage: string } {
  if (!APPROVAL_ACTIONS.includes(input.action as ApprovalAction)) throw new ValidationError("Invalid approval step", { action: `Use one of: ${APPROVAL_ACTIONS.join(", ")}` });
  const action = input.action as ApprovalAction;
  if (action === "publish") return { action, stage: "" };
  const stage = typeof input.stage === "string" ? input.stage.trim() : "";
  if (!environmentKeys.includes(stage)) throw new ValidationError("Invalid approval step", { stage: `Use one of the organization's environments: ${environmentKeys.join(", ")}` });
  return { action, stage };
}

/** Valida y normaliza una regla escrita por una persona. `validRoles` son los roles de experimento que existen. */
export function validateRule(
  input: { action: unknown; stage?: unknown; requirements?: unknown; approvers?: unknown },
  ctx: { validRoles: readonly string[]; environmentKeys: readonly string[] },
): ApprovalRule {
  const fail = (field: string, message: string): never => {
    throw new ValidationError("Invalid approval rule", { [field]: message });
  };
  if (!APPROVAL_ACTIONS.includes(input.action as ApprovalAction)) fail("action", `Use one of: ${APPROVAL_ACTIONS.join(", ")}`);
  const action = input.action as ApprovalAction;

  let stage = "";
  if (action === "promote") {
    stage = typeof input.stage === "string" ? input.stage.trim() : "";
    if (!ctx.environmentKeys.includes(stage)) fail("stage", `Use one of the organization's environments: ${ctx.environmentKeys.join(", ")}`);
  } else if (input.stage !== undefined && input.stage !== "" && input.stage !== null) {
    fail("stage", "Publishing has no stage");
  }

  const rawReqs = Array.isArray(input.requirements) ? input.requirements : [];
  if (rawReqs.length > MAX_REQUIREMENTS) fail("requirements", `At most ${MAX_REQUIREMENTS} profiles`);
  const allowedRoles = action === "publish" ? ctx.validRoles.filter((r) => PUBLISH_APPROVER_ROLES.includes(r)) : ctx.validRoles;
  const byRole = new Map<string, number>();
  for (const raw of rawReqs) {
    const r = raw as { role?: unknown; min?: unknown };
    if (typeof r.role !== "string" || !allowedRoles.includes(r.role)) {
      fail("requirements", action === "publish" ? `Publishing is approved by: ${PUBLISH_APPROVER_ROLES.join(", ")}` : `Unknown profile "${String(r.role)}"`);
    }
    if (typeof r.min !== "number" || !Number.isInteger(r.min) || r.min < MIN_APPROVALS || r.min > MAX_APPROVALS) {
      fail("requirements", `Approvals per profile: a whole number from ${MIN_APPROVALS} to ${MAX_APPROVALS}`);
    }
    if (byRole.has(r.role as string)) fail("requirements", `The profile "${r.role}" appears twice`);
    byRole.set(r.role as string, r.min as number);
  }

  const rawApprovers = Array.isArray(input.approvers) ? input.approvers : [];
  if (rawApprovers.some((a) => typeof a !== "string" || a === "")) fail("approvers", "Approvers are user ids");
  const approvers = [...new Set(rawApprovers as string[])];
  if (approvers.length > MAX_RULE_APPROVERS) fail("approvers", `At most ${MAX_RULE_APPROVERS} default approvers`);

  if (byRole.size === 0 && approvers.length === 0) fail("requirements", "Add at least one profile or one default approver (to remove the rule, delete it)");
  return { action, stage, requirements: [...byRole].map(([role, min]) => ({ role, min })), approvers };
}

/**
 * La regla más estricta que resulta de apilar varias del mismo paso (la de la organización y las de los experimentos del
 * prompt): por perfil gana el mayor mínimo y los aprobadores se suman. Apilar nunca afloja nada.
 * Sin ninguna regla devuelve null: la acción no exige aprobación.
 */
export function mergeRules(rules: readonly ApprovalRule[]): ApprovalRule | null {
  if (rules.length === 0) return null;
  const mins = new Map<string, number>();
  const approvers = new Set<string>();
  for (const rule of rules) {
    for (const req of rule.requirements) mins.set(req.role, Math.max(mins.get(req.role) ?? 0, req.min));
    for (const a of rule.approvers) approvers.add(a);
  }
  return { action: rules[0]!.action, stage: rules[0]!.stage, requirements: [...mins].map(([role, min]) => ({ role, min })), approvers: [...approvers] };
}

/** Las reglas que hay en juego para un paso de un prompt: la de su organización, las de sus agentes y qué agentes están exentos. */
export interface RuleSet {
  organization: ApprovalRule | null;
  experiments: ApprovalRule[];
  /** agentes (de los del prompt) a los que un `org_admin` ha eximido de la regla de la organización en este paso */
  exemptExperimentIds: string[];
}

/**
 * Las reglas que se apilan para un prompt. La regla de la organización deja de aplicar solo si TODOS los agentes del prompt
 * están exentos: si alguno no lo está, ese agente la sigue exigiendo y gana la más estricta (igual que al apilar agentes).
 * Un prompt sin agentes no tiene a quién eximir y sigue la regla de la organización.
 */
export function applicableRules(set: RuleSet, experimentIds: readonly string[]): ApprovalRule[] {
  const exempt = new Set(set.exemptExperimentIds);
  const organizationApplies = experimentIds.length === 0 || experimentIds.some((id) => !exempt.has(id));
  return [...(organizationApplies && set.organization ? [set.organization] : []), ...set.experiments];
}

/** ¿`candidate` exige menos que `base` en algo? Un experimento que hiciera eso afloja la regla de la organización. */
export function looserThan(candidate: ApprovalRule, base: ApprovalRule): string | null {
  for (const req of base.requirements) {
    const have = candidate.requirements.find((r) => r.role === req.role)?.min ?? 0;
    if (have < req.min) return `The organization requires ${req.min} approval(s) from "${req.role}"; a rule here cannot ask for fewer`;
  }
  const missing = base.approvers.filter((a) => !candidate.approvers.includes(a));
  if (missing.length > 0) return "The organization's default approvers cannot be removed here";
  return null;
}

/** Una persona que puede decidir, con los perfiles que tiene en los agentes del prompt. */
export interface ApproverInfo {
  userId: string;
  roles: string[];
}

export interface ApprovalEvaluation {
  /** `rejected` si alguien rechazó; `approved` cuando se cumple todo; `pending` mientras falte algo */
  outcome: "approved" | "pending" | "rejected";
  /** por perfil: cuántas aprobaciones hacen falta y cuántas hay */
  roles: { role: string; need: number; have: number }[];
  /** aprobadores obligatorios (regla + solicitud) que aún no han aprobado */
  missingApprovers: string[];
  /** quién rechazó, si alguien lo hizo */
  rejectedBy: string | null;
  reason: string;
}

/**
 * Decide si una solicitud está aprobada. Reglas:
 * - La aprobación de quien la pidió no cuenta nunca (cuatro ojos).
 * - Una aprobación suma al perfil que la persona tiene; si tiene varios, suma a todos los que la regla pide.
 * - Todo aprobador obligatorio (de la regla o añadido a la solicitud) tiene que haber aprobado.
 * - Un solo rechazo de alguien que podía decidir cierra la solicitud.
 */
export function evaluateApproval(input: {
  rule: ApprovalRule;
  requestedBy: string | null;
  extraApprovers: readonly string[];
  decisions: readonly Pick<ApprovalDecision, "userId" | "decision">[];
  people: readonly ApproverInfo[];
}): ApprovalEvaluation {
  const { rule, requestedBy } = input;
  const rolesOf = new Map(input.people.map((p) => [p.userId, p.roles]));
  const required = [...new Set([...rule.approvers, ...input.extraApprovers])].filter((id) => id !== requestedBy);

  const counts = rule.requirements.map((req) => ({ role: req.role, need: req.min, have: 0 }));
  const approved = new Set<string>();
  let rejectedBy: string | null = null;
  for (const d of input.decisions) {
    if (d.userId === requestedBy) continue;
    // no cuenta quien no puede decidir: ni tiene el perfil pedido ni es aprobador obligatorio
    const roles = rolesOf.get(d.userId);
    const isRequired = required.includes(d.userId);
    const matches = counts.filter((c) => roles?.includes(c.role));
    if (!isRequired && matches.length === 0) continue;
    if (d.decision === "reject") {
      rejectedBy = rejectedBy ?? d.userId;
      continue;
    }
    if (approved.has(d.userId)) continue;
    approved.add(d.userId);
    for (const c of matches) c.have += 1;
  }

  const missingApprovers = required.filter((id) => !approved.has(id));
  const unmet = counts.filter((c) => c.have < c.need);
  if (rejectedBy !== null) return { outcome: "rejected", roles: counts, missingApprovers, rejectedBy, reason: "Someone who could decide rejected it" };
  if (unmet.length === 0 && missingApprovers.length === 0) return { outcome: "approved", roles: counts, missingApprovers: [], rejectedBy: null, reason: "All the approvals needed are in" };
  const parts = [
    ...unmet.map((c) => `${c.need - c.have} more from "${c.role}"`),
    ...(missingApprovers.length > 0 ? [`${missingApprovers.length} required approver(s) still to answer`] : []),
  ];
  return { outcome: "pending", roles: counts, missingApprovers, rejectedBy: null, reason: `Waiting for ${parts.join(" and ")}` };
}

/**
 * ¿Se puede llegar a reunir lo que pide la regla con las personas que hay, sin contar a quien la pide? Se comprueba al abrir la
 * solicitud para no dejar una que nadie podrá aprobar. Devuelve el motivo si no, o null si es posible.
 */
export function unreachableReason(input: { rule: ApprovalRule; requestedBy: string | null; extraApprovers: readonly string[]; people: readonly ApproverInfo[] }): string | null {
  const pool = input.people.filter((p) => p.userId !== input.requestedBy);
  for (const req of input.rule.requirements) {
    const eligible = pool.filter((p) => p.roles.includes(req.role)).length;
    if (eligible < req.min) return `It needs ${req.min} approval(s) from "${req.role}" but only ${eligible} other person(s) with that profile can approve`;
  }
  const poolIds = new Set(pool.map((p) => p.userId));
  const absent = [...new Set([...input.rule.approvers, ...input.extraApprovers])].filter((id) => id !== input.requestedBy && !poolIds.has(id));
  if (absent.length > 0) return "A required approver cannot approve here (they are not a member with the approve permission)";
  return null;
}

export function validateNote(raw: unknown): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text.length > MAX_NOTE) throw new ValidationError("The note is too long", { note: `At most ${MAX_NOTE} characters` });
  return text;
}

/** ¿Ha caducado una solicitud viva? Una pendiente o aprobada-sin-ejecutar pasada su fecha ya no se puede decidir ni ejecutar. */
export function isExpired(request: Pick<ApprovalRequest, "status" | "expiresAt">, now: Date): boolean {
  return (request.status === "pending" || request.status === "approved") && new Date(request.expiresAt).getTime() <= now.getTime();
}

export function expiryFrom(now: Date): string {
  return new Date(now.getTime() + REQUEST_TTL_DAYS * 24 * 3600 * 1000).toISOString();
}
