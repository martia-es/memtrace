import { ApprovalRuleResolver } from "@/application/approval-rules";
import type { ApprovalRepository } from "@/application/ports/approval-repository";
import type { IdentityRepository } from "@/application/ports/identity-repository";
import type { PromptRepository } from "@/application/ports/prompt-repository";
import type { PromptGatePort } from "@/application/prompt-gate-service";
import type { PromptService } from "@/application/prompt-service";
import {
  evaluateApproval,
  expiryFrom,
  isExpired,
  looserThan,
  PUBLISH_APPROVER_ROLES,
  unreachableReason,
  validateNote,
  validateRule,
  type ApprovalAction,
  type ApprovalEvaluation,
  type ApprovalRequest,
  type ApprovalRule,
  type ApprovalScope,
  type ApproverInfo,
} from "@/domain/approval";
import { validateBypassReason } from "@/domain/deploy";
import { ApprovalNotAllowedError, PromptGateBlockedError, PromptInvariantError, PromptNotFoundError, ValidationError } from "@/domain/errors";
import { isEnvironmentTag, type Prompt } from "@/domain/prompt";

/** Una solicitud con lo necesario para pintarla: dónde va, qué falta, quién es quién. */
export interface ApprovalView {
  request: ApprovalRequest;
  promptName: string;
  /** lo que exige hoy la regla efectiva; null si ya no hay regla */
  rule: ApprovalRule | null;
  evaluation: ApprovalEvaluation;
  /** nombre (o email) de cada persona que aparece, por id de usuario */
  people: Record<string, string>;
}

const LIST_LIMIT = 100;
const MAX_EXTRA_APPROVERS = 10;

/**
 * Aprobaciones de prompts (ADR-076): reglas por organización y experimento (el experimento solo endurece), solicitudes de
 * publicar una versión o promoverla a un entorno, y decisiones de quienes pueden aprobar. La autorización de la ruta decide
 * quién puede pedir, aprobar o configurar; aquí se aplican las reglas.
 */
export class ApprovalService {
  private readonly resolver: ApprovalRuleResolver;

  constructor(
    private readonly approvals: ApprovalRepository,
    private readonly prompts: PromptService,
    private readonly promptRepo: PromptRepository,
    private readonly gate: PromptGatePort,
    private readonly identity: Pick<IdentityRepository, "getUsersByIds">,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.resolver = new ApprovalRuleResolver(approvals);
  }

  // ---- reglas ----

  listRules(scope: ApprovalScope): Promise<ApprovalRule[]> {
    return this.approvals.listRules(scope);
  }

  /** Lo que se puede elegir al escribir una regla: los perfiles y las personas que pueden aprobar. */
  async options(organizationId: string, experimentId?: string) {
    const [roles, environments, candidates] = await Promise.all([
      this.approvals.experimentRoleNames(),
      this.promptRepo.environmentKeys(organizationId),
      this.approvals.approverCandidates(organizationId, experimentId),
    ]);
    return { roles, environments, candidates };
  }

  /** Las reglas del ámbito con lo que se puede elegir; en un experimento, también el suelo que pone la organización. */
  async rulesWithOptions(scope: ApprovalScope, organizationId: string) {
    const [rules, organizationRules, options] = await Promise.all([
      this.approvals.listRules(scope),
      scope.type === "experiment" ? this.approvals.listRules({ type: "organization", id: organizationId }) : Promise.resolve(undefined),
      this.options(organizationId, scope.type === "experiment" ? scope.id : undefined),
    ]);
    return { rules, organizationRules, options: { ...options, publishRoles: [...PUBLISH_APPROVER_ROLES] } };
  }

  /**
   * Crea o cambia la regla de una acción y paso. Un experimento no puede pedir menos que su organización: el suelo lo pone
   * la organización. Los aprobadores por defecto tienen que poder aprobar (miembros con `prompt:approve`).
   */
  async setRule(scope: ApprovalScope, organizationId: string, userId: string, input: { action: unknown; stage?: unknown; requirements?: unknown; approvers?: unknown }): Promise<ApprovalRule> {
    const [validRoles, environmentKeys] = await Promise.all([this.approvals.experimentRoleNames(), this.promptRepo.environmentKeys(organizationId)]);
    const rule = validateRule(input, { validRoles, environmentKeys });
    if (rule.approvers.length > 0) {
      const candidates = new Set((await this.approvals.approverCandidates(organizationId, scope.type === "experiment" ? scope.id : undefined)).map((c) => c.userId));
      const unknown = rule.approvers.filter((id) => !candidates.has(id));
      if (unknown.length > 0) throw new ValidationError("Invalid approval rule", { approvers: "Default approvers have to be members with permission to approve" });
    }
    if (scope.type === "experiment") {
      const floor = (await this.approvals.listRules({ type: "organization", id: organizationId })).find((r) => r.action === rule.action && r.stage === rule.stage);
      const looser = floor ? looserThan(rule, floor) : null;
      if (looser) throw new ValidationError("This rule is looser than the organization's", { requirements: looser });
    }
    return this.approvals.setRule(scope, rule, userId);
  }

  async deleteRule(scope: ApprovalScope, action: ApprovalAction, stage: string): Promise<void> {
    if (!(await this.approvals.deleteRule(scope, action, stage))) throw new PromptNotFoundError("Approval rule");
  }

  /** Las personas que pueden aprobar sobre un prompt, con nombre y perfiles: a quién se puede añadir a una solicitud. */
  async directory(prompt: Prompt): Promise<Array<{ userId: string; name: string; roles: string[] }>> {
    const people = await this.approvals.approvers(prompt.experimentIds);
    const users = people.length > 0 ? await this.identity.getUsersByIds(people.map((p) => p.userId)) : [];
    const names = new Map(users.map((u) => [u.id, u.name?.trim() || u.email]));
    return people.map((p) => ({ userId: p.userId, name: names.get(p.userId) ?? "Someone", roles: p.roles })).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Lo que exige hoy cada acción sobre un prompt (organización + agentes apilados). */
  async effectiveRules(prompt: Prompt): Promise<ApprovalRule[]> {
    const keys = await this.promptRepo.environmentKeys(prompt.organizationId);
    const rules = await Promise.all([this.resolver.effectiveRule(prompt, "publish", ""), ...keys.map((k) => this.resolver.effectiveRule(prompt, "promote", k))]);
    return rules.filter((r): r is ApprovalRule => r !== null);
  }

  // ---- solicitudes ----

  async open(
    prompt: Prompt,
    userId: string,
    input: { action: ApprovalAction; version: number; tag?: string; note?: string; bypassReason?: string | null; extraApprovers?: string[] },
    canBypass: boolean,
  ): Promise<ApprovalView> {
    if (prompt.archivedAt) throw new PromptInvariantError("The prompt is archived; restore it before asking for approval");
    const note = validateNote(input.note);
    const version = await this.promptRepo.getVersion(prompt.id, input.version);
    if (!version) throw new PromptNotFoundError(`Version ${input.version}`);

    let tag = "";
    let bypassReason: string | null = null;
    if (input.action === "publish") {
      if (version.status !== "draft") throw new PromptInvariantError(`v${input.version} is already published`);
    } else {
      tag = (input.tag ?? "").trim();
      if (!isEnvironmentTag(tag, await this.promptRepo.environmentKeys(prompt.organizationId))) throw new ValidationError("Invalid environment", { tag: "Use one of the organization's environments" });
      if (version.status === "draft") throw new PromptInvariantError(`v${input.version} is a draft: publish it before promoting it`);
      if (await this.promptRepo.wasServed(prompt.id, tag, input.version)) throw new PromptInvariantError(`v${input.version} already served "${tag}": going back to it is a rollback and needs no approval`);
      // no tiene sentido reunir aprobaciones para algo que el gate de evaluación no dejaría hacer
      const gate = await this.gate.check(prompt, tag, input.version);
      if (!gate.allowed) {
        if (input.bypassReason === undefined || input.bypassReason === null) throw new PromptGateBlockedError(gate.reason, gate);
        if (!canBypass) throw new PromptGateBlockedError(`${gate.reason} Skipping the evaluation requires the governance permission.`, gate);
        bypassReason = validateBypassReason(input.bypassReason);
      }
    }

    const rule = await this.resolver.effectiveRule(prompt, input.action, tag);
    if (!rule) throw new PromptInvariantError("This action needs no approval: do it directly");

    const people = await this.approvals.approvers(prompt.experimentIds);
    const extra = [...new Set(input.extraApprovers ?? [])];
    if (extra.length > MAX_EXTRA_APPROVERS) throw new ValidationError("Too many approvers", { extraApprovers: `At most ${MAX_EXTRA_APPROVERS}` });
    const eligible = new Set(people.map((p) => p.userId));
    if (extra.some((id) => id === userId || !eligible.has(id))) throw new ValidationError("Invalid approver", { extraApprovers: "Approvers have to be other members with permission to approve" });
    const blocked = unreachableReason({ rule, requestedBy: userId, extraApprovers: extra, people });
    if (blocked) throw new PromptInvariantError(`Nobody could approve this request: ${blocked}`);

    const created = await this.approvals.createRequest({ promptId: prompt.id, action: input.action, version: input.version, tag, note, bypassReason, requestedBy: userId, extraApprovers: extra, expiresAt: expiryFrom(this.now()) });
    if (!created) throw new PromptInvariantError("There is already an open request for this");
    return this.view(created, prompt);
  }

  async get(requestId: string): Promise<{ request: ApprovalRequest; prompt: Prompt }> {
    const found = await this.approvals.getRequest(requestId);
    if (!found) throw new PromptNotFoundError("Approval request");
    const prompt = await this.prompts.get(found.promptId);
    return { request: await this.refresh(found), prompt };
  }

  async list(prompt: Prompt): Promise<ApprovalView[]> {
    const requests = await Promise.all((await this.approvals.listRequests(prompt.id, LIST_LIMIT)).map((r) => this.refresh(r)));
    return this.viewAll(requests.map((request) => ({ request, prompt })));
  }

  /** Lo que esta persona tiene pendiente de decidir en la organización: solicitudes vivas donde puede aprobar y aún no ha respondido. Con `experimentId`, solo las de prompts de ese agente. */
  async inbox(organizationId: string, userId: string, experimentId?: string): Promise<ApprovalView[]> {
    const open = await this.approvals.listOpenForOrganization(organizationId);
    const memo = new Memo(this.resolver, this.approvals);
    const prompts = new Map<string, Promise<Prompt | null>>();
    const items: Array<{ request: ApprovalRequest; prompt: Prompt }> = [];
    for (const raw of open) {
      const request = await this.refresh(raw);
      if (request.status !== "pending" || request.requestedBy === userId || request.decisions.some((d) => d.userId === userId)) continue;
      if (!prompts.has(request.promptId)) prompts.set(request.promptId, this.promptRepo.get(request.promptId));
      const prompt = await prompts.get(request.promptId);
      if (!prompt || (experimentId && !prompt.experimentIds.includes(experimentId))) continue;
      const [rule, people] = await Promise.all([memo.rule(prompt, request.action, request.tag), memo.people(prompt)]);
      if (this.mayDecide(userId, rule, request, people)) items.push({ request, prompt });
    }
    return this.viewAll(items, memo);
  }

  async view(request: ApprovalRequest, prompt: Prompt): Promise<ApprovalView> {
    return (await this.viewAll([{ request, prompt }]))[0]!;
  }

  /** Varias vistas a la vez: la regla y los aprobadores se calculan una vez por prompt y los nombres, en una sola consulta. */
  private async viewAll(items: Array<{ request: ApprovalRequest; prompt: Prompt }>, memo = new Memo(this.resolver, this.approvals)): Promise<ApprovalView[]> {
    const partial = await Promise.all(
      items.map(async ({ request, prompt }) => {
        const [rule, people] = await Promise.all([memo.rule(prompt, request.action, request.tag), memo.people(prompt)]);
        return { request, prompt, rule, evaluation: this.evaluate(request, rule, people) };
      }),
    );
    const ids = [...new Set(partial.flatMap((p) => [p.request.requestedBy, ...p.request.decisions.map((d) => d.userId), ...p.request.extraApprovers, ...(p.rule?.approvers ?? [])]).filter((id): id is string => !!id))];
    const users = ids.length > 0 ? await this.identity.getUsersByIds(ids) : [];
    const names = new Map(users.map((u) => [u.id, u.name?.trim() || u.email]));
    return partial.map(({ request, prompt, rule, evaluation }) => {
      const mine = [request.requestedBy, ...request.decisions.map((d) => d.userId), ...request.extraApprovers, ...(rule?.approvers ?? [])].filter((id): id is string => !!id && names.has(id));
      return { request, promptName: prompt.name, rule, evaluation, people: Object.fromEntries(mine.map((id) => [id, names.get(id)!])) };
    });
  }

  /** Aprueba o rechaza. Al reunirse todo lo que pide la regla, la acción se ejecuta; si el gate la frena, queda aprobada con el motivo. */
  async decide(requestId: string, userId: string, input: { decision: "approve" | "reject"; comment?: string }): Promise<ApprovalView> {
    const { request, prompt } = await this.get(requestId);
    if (request.status !== "pending") throw new PromptInvariantError(`This request is ${request.status}`);
    if (request.requestedBy === userId) throw new ApprovalNotAllowedError("You cannot decide your own request");
    const people = await this.approvals.approvers(prompt.experimentIds);
    const rule = await this.resolver.effectiveRule(prompt, request.action, request.tag);
    if (!this.mayDecide(userId, rule, request, people)) throw new ApprovalNotAllowedError("Your profile is not one of those that can approve this request");

    await this.approvals.saveDecision(requestId, { userId, decision: input.decision, comment: validateNote(input.comment) });
    const updated = (await this.approvals.getRequest(requestId))!;
    const evaluation = this.evaluate(updated, rule, people);
    if (evaluation.outcome === "rejected") await this.approvals.setStatus(requestId, "rejected");
    if (evaluation.outcome === "approved") {
      await this.approvals.setStatus(requestId, "approved");
      await this.run(updated, prompt, userId);
    }
    return this.view((await this.approvals.getRequest(requestId))!, prompt);
  }

  /** Reintenta ejecutar una solicitud aprobada que no pudo ejecutarse (por ejemplo, el gate de evaluación aún no pasaba). */
  async execute(requestId: string, userId: string): Promise<ApprovalView> {
    const { request, prompt } = await this.get(requestId);
    if (request.status === "executed") throw new PromptInvariantError("This request was already carried out");
    if (request.status !== "approved" && request.status !== "pending") throw new PromptInvariantError(`This request is ${request.status}, not approved`);
    // la regla pudo cambiar desde que se pidió: se vuelve a evaluar con la regla de hoy. Si se endureció, vuelve a pendiente;
    // si desapareció (la organización la quitó) una pendiente ya no espera a nadie y se puede ejecutar
    const evaluation = this.evaluate(request, await this.resolver.effectiveRule(prompt, request.action, request.tag), await this.approvals.approvers(prompt.experimentIds));
    if (evaluation.outcome !== "approved") {
      if (request.status === "approved") await this.approvals.setStatus(requestId, "pending", { executionError: null });
      throw new PromptInvariantError(`The rule needs more approvals: ${evaluation.reason}`);
    }
    await this.run(request, prompt, userId);
    return this.view((await this.approvals.getRequest(requestId))!, prompt);
  }

  /** Retira la solicitud. Solo quien la pidió. */
  async cancel(requestId: string, userId: string): Promise<ApprovalView> {
    const { request, prompt } = await this.get(requestId);
    if (request.requestedBy !== userId) throw new ApprovalNotAllowedError("Only the person who made the request can cancel it");
    if (request.status !== "pending" && request.status !== "approved") throw new PromptInvariantError(`This request is ${request.status}`);
    await this.approvals.setStatus(requestId, "cancelled");
    return this.view((await this.approvals.getRequest(requestId))!, prompt);
  }

  /** Añade a una persona como aprobadora obligatoria de ESTA solicitud. La pueden añadir quien la pidió y quienes pueden aprobar. */
  async addApprover(requestId: string, userId: string, approverId: string): Promise<ApprovalView> {
    const { request, prompt } = await this.get(requestId);
    if (request.status !== "pending") throw new PromptInvariantError(`This request is ${request.status}`);
    const people = await this.approvals.approvers(prompt.experimentIds);
    const rule = await this.resolver.effectiveRule(prompt, request.action, request.tag);
    if (request.requestedBy !== userId && !this.mayDecide(userId, rule, request, people)) throw new ApprovalNotAllowedError("Only the requester or an approver can add approvers");
    if (approverId === request.requestedBy || !people.some((p) => p.userId === approverId)) throw new ValidationError("Invalid approver", { approverId: "Approvers have to be other members with permission to approve" });
    await this.approvals.addExtraApprover(requestId, approverId, userId);
    return this.view((await this.approvals.getRequest(requestId))!, prompt);
  }

  // ---- internos ----

  /** Una solicitud viva pasada su fecha ya no se puede decidir ni ejecutar. */
  private async refresh(request: ApprovalRequest): Promise<ApprovalRequest> {
    if (!isExpired(request, this.now())) return request;
    await this.approvals.setStatus(request.id, "expired");
    return { ...request, status: "expired" };
  }

  private evaluate(request: ApprovalRequest, rule: ApprovalRule | null, people: ApproverInfo[]): ApprovalEvaluation {
    // sin regla (se borró después de pedir) ya no hay nada que reunir
    if (!rule) return { outcome: "approved", roles: [], missingApprovers: [], rejectedBy: null, reason: "No approval is required any more" };
    return evaluateApproval({ rule, requestedBy: request.requestedBy, extraApprovers: request.extraApprovers, decisions: request.decisions, people });
  }

  /** ¿Puede esta persona decidir? Necesita poder aprobar y tener alguno de los perfiles de la regla, o ser aprobadora obligatoria. */
  private mayDecide(userId: string, rule: ApprovalRule | null, request: ApprovalRequest, people: ApproverInfo[]): boolean {
    const me = people.find((p) => p.userId === userId);
    if (!me || !rule) return false;
    return rule.approvers.includes(userId) || request.extraApprovers.includes(userId) || rule.requirements.some((r) => me.roles.includes(r.role));
  }

  /** Ejecuta la acción aprobada. Un fallo (el gate, un prompt archivado) no se pierde: la solicitud sigue aprobada con el motivo. */
  private async run(request: ApprovalRequest, prompt: Prompt, actingUserId: string): Promise<void> {
    // dos aprobaciones casi a la vez pueden llegar aquí las dos: solo una consigue la reserva y ejecuta; la otra no hace nada
    if (!(await this.approvals.claimExecution(request.id))) return;
    try {
      if (request.action === "publish") {
        await this.prompts.publishDraft(prompt.id, request.version, true);
      } else {
        const names = await this.approverNames(request);
        const reason = `Approved by ${names}${request.note ? `. ${request.note}` : ""}`.slice(0, 500);
        await this.prompts.moveTag(prompt.id, request.requestedBy ?? actingUserId, { tag: request.tag, version: request.version, reason, bypassReason: request.bypassReason }, true, request.bypassReason !== null, true);
      }
      await this.approvals.setStatus(request.id, "executed", { executionError: null });
    } catch (error) {
      // la ejecución falló: se suelta la reserva para que se pueda reintentar y se anota por qué
      await this.approvals.releaseExecution(request.id);
      const message = error instanceof Error ? error.message : "It could not be carried out";
      await this.approvals.setStatus(request.id, "approved", { executionError: message.slice(0, 500) });
    }
  }

  private async approverNames(request: ApprovalRequest): Promise<string> {
    const ids = request.decisions.filter((d) => d.decision === "approve").map((d) => d.userId);
    const users = ids.length > 0 ? await this.identity.getUsersByIds(ids) : [];
    return users.map((u) => u.name?.trim() || u.email).join(", ");
  }
}

/** Reglas efectivas y aprobadores calculados una sola vez por prompt dentro de una misma operación (listas y bandeja). */
class Memo {
  private readonly rules = new Map<string, Promise<ApprovalRule | null>>();
  private readonly peopleByKey = new Map<string, Promise<ApproverInfo[]>>();

  constructor(
    private readonly resolver: ApprovalRuleResolver,
    private readonly approvals: Pick<ApprovalRepository, "approvers">,
  ) {}

  rule(prompt: Prompt, action: ApprovalAction, stage: string): Promise<ApprovalRule | null> {
    const key = `${prompt.organizationId}|${[...prompt.experimentIds].sort().join(",")}|${action}|${stage}`;
    if (!this.rules.has(key)) this.rules.set(key, this.resolver.effectiveRule(prompt, action, stage));
    return this.rules.get(key)!;
  }

  people(prompt: Prompt): Promise<ApproverInfo[]> {
    const key = [...prompt.experimentIds].sort().join(",");
    if (!this.peopleByKey.has(key)) this.peopleByKey.set(key, this.approvals.approvers(prompt.experimentIds));
    return this.peopleByKey.get(key)!;
  }
}
