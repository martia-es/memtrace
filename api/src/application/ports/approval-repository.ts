import type { ApprovalAction, ApprovalDecision, ApprovalRequest, ApprovalRule, ApprovalScope, ApprovalStatus, ApproverInfo, RuleSet } from "@/domain/approval";

export interface NewApprovalRequest {
  promptId: string;
  action: ApprovalAction;
  version: number;
  tag: string;
  note: string;
  bypassReason: string | null;
  requestedBy: string;
  extraApprovers: string[];
  expiresAt: string;
}

/** Reglas y solicitudes de aprobación de prompts (ADR-076). PostgreSQL. */
export interface ApprovalRepository {
  /** Las reglas de un ámbito (la organización o un experimento). */
  listRules(scope: ApprovalScope): Promise<ApprovalRule[]>;
  /** Crea o sustituye la regla de esa acción y paso en el ámbito. */
  setRule(scope: ApprovalScope, rule: ApprovalRule, userId: string): Promise<ApprovalRule>;
  deleteRule(scope: ApprovalScope, action: ApprovalAction, stage: string): Promise<boolean>;
  /** Lo que hay en juego en ese paso para un prompt: la regla de su organización, las de sus agentes y cuáles están exentos. */
  rulesFor(organizationId: string, experimentIds: readonly string[], action: ApprovalAction, stage: string): Promise<RuleSet>;

  /** Pasos de los que un `org_admin` ha eximido a ese experimento (ADR-076, excepciones). */
  listExemptions(experimentId: string): Promise<Array<{ action: ApprovalAction; stage: string }>>;
  /** Idempotente: eximir dos veces deja una sola excepción. */
  setExemption(experimentId: string, action: ApprovalAction, stage: string, userId: string): Promise<void>;
  deleteExemption(experimentId: string, action: ApprovalAction, stage: string): Promise<boolean>;

  /**
   * Quién puede aprobar sobre un prompt: miembros de alguno de sus agentes cuyo rol tiene `prompt:approve`, con los perfiles
   * (roles de experimento) que tienen en ellos.
   */
  approvers(experimentIds: readonly string[]): Promise<ApproverInfo[]>;
  /** Personas de la organización a las que se puede nombrar aprobador por defecto: miembros de cualquier agente con `prompt:approve`. */
  approverCandidates(organizationId: string, experimentId?: string): Promise<Array<ApproverInfo & { email: string; name: string | null }>>;
  /** Roles de experimento que existen. */
  experimentRoleNames(): Promise<string[]>;

  /** Crea la solicitud. Ya hay una viva para el mismo destino -> null. */
  createRequest(input: NewApprovalRequest): Promise<ApprovalRequest | null>;
  getRequest(requestId: string): Promise<ApprovalRequest | null>;
  /** Más recientes primero. */
  listRequests(promptId: string, limit: number): Promise<ApprovalRequest[]>;
  /** Solicitudes vivas (pendientes o aprobadas sin ejecutar) de los prompts de la organización. */
  listOpenForOrganization(organizationId: string): Promise<ApprovalRequest[]>;
  /** Registra la decisión de la persona (una por solicitud; cambiarla la sustituye). */
  saveDecision(requestId: string, decision: Pick<ApprovalDecision, "userId" | "decision" | "comment">): Promise<void>;
  addExtraApprover(requestId: string, userId: string, addedBy: string): Promise<void>;
  setStatus(requestId: string, status: ApprovalStatus, patch?: { executionError?: string | null }): Promise<void>;
  /**
   * Reserva la ejecución de la acción aprobada, de forma atómica: devuelve true a UNA sola llamada aunque lleguen varias a la vez.
   * La reserva caduca a los 2 minutos por si el proceso muere a mitad.
   */
  claimExecution(requestId: string): Promise<boolean>;
  /** Libera la reserva (la ejecución falló) para poder reintentarla. */
  releaseExecution(requestId: string): Promise<void>;
}
