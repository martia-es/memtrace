import type { ApprovalRequestDto, ApprovalRuleDto, ApprovalRulesResponse, PromptApprovalsResponse, PromptDetailDto, PromptEvidenceResponse, PromptGateDto, PromptMapDto, PromptPlaygroundResponse, PromptPolicyDto, PromptSummaryDto, PromptTagEventDto, PromptVersionDto } from "@contract";

/** Puerto de salida: registro de prompts (ADR-067). */

export interface NewPromptInput {
  /** `fragment`: texto compartido que otros prompts incluyen con `{{> nombre@tag}}` (ADR-073) */
  kind?: "prompt" | "fragment";
  name: string;
  description: string;
  content: string;
  message: string;
  /** agentes adicionales al actual (un prompt puede ser de varios) */
  experimentIds?: string[];
}

export interface PromptApi {
  /** Prompts del agente (los de la organización asociados a él). */
  listForAgent(experimentId: string, includeArchived: boolean, signal?: AbortSignal): Promise<PromptSummaryDto[]>;
  /** Crea el prompt con su versión 1, asociado a este agente. */
  create(experimentId: string, input: NewPromptInput, signal?: AbortSignal): Promise<PromptDetailDto>;
  get(promptId: string, signal?: AbortSignal): Promise<PromptDetailDto>;
  update(promptId: string, patch: { description?: string; archived?: boolean; experimentIds?: string[] }, signal?: AbortSignal): Promise<PromptDetailDto>;
  /**
   * Guarda una versión. Con `draft` queda como borrador (ADR-072): se puede probar y evaluar, pero no recibe tags hasta
   * publicarse. `origin` recuerda el fallo que se quería arreglar.
   */
  saveVersion(
    promptId: string,
    input: { content: string; message: string; parentVersion?: number | null; draft?: boolean; origin?: { traceIds: string[]; cause: string | null; rationale: string } | null },
    signal?: AbortSignal,
  ): Promise<PromptVersionDto>;
  /** Vuelve a resolver los fragmentos de la última versión publicada y guarda el resultado como BORRADOR (ADR-073). */
  rebuild(promptId: string, signal?: AbortSignal): Promise<PromptVersionDto>;
  /** Un fragmento cambió: reconstruye como borradores los prompts que lo usan y se han quedado atrás. */
  rebuildDependents(promptId: string, signal?: AbortSignal): Promise<{ created: Array<{ promptId: string; name: string; version: number }>; skipped: Array<{ promptId: string; name: string; reason: string }> }>;
  /** Publica un borrador: pasa a ser una versión normal que ya puede recibir tags. Lo decide una persona. */
  publishDraft(promptId: string, version: number, signal?: AbortSignal): Promise<PromptVersionDto>;
  /** Descarta un borrador. Una versión publicada no se borra nunca. */
  discardDraft(promptId: string, version: number, signal?: AbortSignal): Promise<void>;
  /** Qué pasó en las trazas que usaron cada versión del prompt (coste, errores, latencia, feedback, scores) en el rango (ADR-069). */
  getEvidence(experimentId: string, promptId: string, range: { from: Date; to: Date }, signal?: AbortSignal): Promise<PromptEvidenceResponse>;
  /**
   * Mueve el tag a una versión; `version = null` lo quita. Los tags de entorno exigen `prompt:promote`. Con una política
   * (ADR-070) los entornos protegidos exigen una evaluación exitosa; `bypassReason` se salta ese gate (exige gobernanza).
   */
  moveTag(promptId: string, tag: string, version: number | null, reason: string, bypassReason?: string | null, signal?: AbortSignal): Promise<PromptTagEventDto>;
  /**
   * Prueba una versión en el asistente real, sin mover ningún tag (ADR-071). Ejecuta el agente de verdad, solo en entornos que
   * no son de producción. `applied: false` = el agente respondió sin aplicar la versión: la respuesta no es suya.
   */
  runPlayground(experimentId: string, promptId: string, input: { deploymentId: string; version: number; message: string; history?: string[] }, signal?: AbortSignal): Promise<PromptPlaygroundResponse>;
  /** ¿Puede ese tag apuntar a esa versión? Veredicto del gate de promoción y por qué (ADR-070). */
  previewGate(promptId: string, tag: string, version: number, signal?: AbortSignal): Promise<PromptGateDto>;
  /** De qué depende y quién depende del prompt (ADR-074). Con `move`, además a quién llegaría mover ese tag a esa versión. */
  map(promptId: string, move?: { tag: string; version: number }, signal?: AbortSignal): Promise<PromptMapDto>;
  /** Crea o cambia la política de promoción: dataset de evaluación y runs seguidos que deben pasar. */
  setPolicy(promptId: string, policy: { datasetId: string; requiredRuns: number }, signal?: AbortSignal): Promise<PromptPolicyDto>;
  /** Quita la política: cualquier versión puede promoverse. */
  deletePolicy(promptId: string, signal?: AbortSignal): Promise<void>;

  // ---- aprobaciones (ADR-076) ----
  /** Las solicitudes del prompt y lo que exige hoy cada acción (organización y agentes apilados). */
  getApprovals(promptId: string, signal?: AbortSignal): Promise<PromptApprovalsResponse>;
  /** Abre una solicitud de publicar un borrador o de apuntar un entorno a una versión. */
  openApproval(promptId: string, input: OpenApprovalInput, signal?: AbortSignal): Promise<ApprovalRequestDto>;
  decideApproval(requestId: string, decision: "approve" | "reject", comment: string, signal?: AbortSignal): Promise<ApprovalRequestDto>;
  /** Reintenta una solicitud aprobada que no pudo ejecutarse (p. ej. el gate de evaluación). */
  executeApproval(requestId: string, signal?: AbortSignal): Promise<ApprovalRequestDto>;
  cancelApproval(requestId: string, signal?: AbortSignal): Promise<ApprovalRequestDto>;
  /** Añade a una persona como aprobadora obligatoria de esta solicitud. */
  addApprover(requestId: string, approverId: string, signal?: AbortSignal): Promise<ApprovalRequestDto>;
  /** Lo que la persona tiene pendiente de decidir en la organización. */
  approvalInbox(organizationId: string, experimentId: string | null, signal?: AbortSignal): Promise<ApprovalRequestDto[]>;
  /** Reglas de aprobación de la organización o de un experimento (en un experimento, con el suelo de la organización). */
  /** Todas las solicitudes (cualquier estado) de la organización o del experimento, las más recientes primero. */
  approvalHistory(scope: ApprovalScope, signal?: AbortSignal): Promise<ApprovalRequestDto[]>;
  getApprovalRules(scope: ApprovalScope, signal?: AbortSignal): Promise<ApprovalRulesResponse>;
  setApprovalRule(scope: ApprovalScope, rule: Pick<ApprovalRuleDto, "action" | "stage" | "requirements" | "approvers">, signal?: AbortSignal): Promise<ApprovalRuleDto>;
  deleteApprovalRule(scope: ApprovalScope, action: "publish" | "promote", stage: string, signal?: AbortSignal): Promise<void>;
}

export type ApprovalScope = { type: "organization" | "experiment"; id: string };

export interface OpenApprovalInput {
  action: "publish" | "promote";
  version: number;
  tag?: string;
  note?: string;
  extraApprovers?: string[];
  bypassReason?: string | null;
}
