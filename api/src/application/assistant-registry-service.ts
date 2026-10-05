import type { AssistantRegistryRepository } from "@/application/ports/assistant-registry-repository";
import type { ChatClient } from "@/application/ports/chat-client";
import type { HealthProber } from "@/application/ports/health-prober";
import {
  MAX_CHAT_MESSAGE_LENGTH,
  buildChatRequest,
  parseChatResponse,
  resolveChatUrl,
  resolveHealthUrl,
  validateChatConfig,
  validateDeclaredConnection,
  validateDeploymentPatch,
  validateNewDeployment,
  validateNewGrant,
  type AccessGrant,
  type AssistantCard,
  type AssistantPatch,
  type Connection,
  type ConnectionStatus,
  type ConnectionWithUsage,
  type DeclaredConnection,
  type Deployment,
  type DeploymentPatch,
  type Environment,
  type HealthCheck,
  type HealthStatus,
  type NewDeployment,
  type NewGrant,
  type ProbeResult,
  type ProbeTarget,
} from "@/domain/assistant-registry";
import { AssistantInvariantError, AssistantNotFoundError, AssistantUpstreamError, ValidationError } from "@/domain/errors";

/** Uso de tools observado en trazas (ClickHouse). Puerto propio para no acoplar el registro al repositorio de trazas. */
export interface ToolUsageSource {
  toolUsage(serviceName: string, from: Date, to: Date): Promise<Array<{ tool: string; calls: number; errors: number }>>;
}

const DAY_MS = 86_400_000;
/** Ventana con la que se mide el uso y se sincronizan las conexiones observadas. */
export const OBSERVATION_WINDOW_DAYS = 7;
/** Tiempo mínimo entre dos comprobaciones manuales del mismo despliegue. */
export const MIN_RECHECK_SECONDS = 10;
/** Historial de sondeos que se conserva. */
export const HEALTH_RETENTION_DAYS = 30;

/** Casos de uso del registro de asistentes (ADR-053). La autorización se comprueba en las rutas con permisos. */
export class AssistantRegistryService {
  constructor(
    private readonly repo: AssistantRegistryRepository,
    private readonly toolUsage: ToolUsageSource,
    private readonly now: () => Date = () => new Date(),
  ) {}

  listEnvironments(organizationId: string): Promise<Environment[]> {
    return this.repo.listEnvironments(organizationId);
  }

  listCatalog(organizationId: string): Promise<AssistantCard[]> {
    return this.repo.listCatalog(organizationId);
  }

  async getCard(experimentId: string): Promise<AssistantCard> {
    const card = await this.repo.getCard(experimentId);
    if (!card) throw new AssistantNotFoundError("Agent");
    return card;
  }

  async update(experimentId: string, patch: AssistantPatch): Promise<AssistantCard> {
    if (patch.chat) validateChatConfig(patch.chat);
    const card = await this.repo.update(experimentId, patch);
    if (!card) throw new AssistantNotFoundError("Assistant");
    return card;
  }

  // ── Despliegues ─────────────────────────────────────────────────────────────────────────────────────────────

  async createDeployment(experimentId: string, input: NewDeployment): Promise<Deployment> {
    validateNewDeployment(input);
    await this.getCard(experimentId);
    return this.repo.createDeployment(experimentId, input);
  }

  async updateDeployment(experimentId: string, deploymentId: string, patch: DeploymentPatch): Promise<Deployment> {
    validateDeploymentPatch(patch);
    const deployment = await this.repo.updateDeployment(experimentId, deploymentId, patch);
    if (!deployment) throw new AssistantNotFoundError("Deployment");
    return deployment;
  }

  async deleteDeployment(experimentId: string, deploymentId: string): Promise<void> {
    if (!(await this.repo.deleteDeployment(experimentId, deploymentId))) throw new AssistantNotFoundError("Deployment");
  }

  async healthHistory(experimentId: string, deploymentId: string, hours: number, limit: number): Promise<HealthCheck[]> {
    const since = new Date(this.now().getTime() - hours * 3_600_000);
    const checks = await this.repo.listHealthChecks(experimentId, deploymentId, since, limit);
    if (!checks) throw new AssistantNotFoundError("Deployment");
    return checks;
  }

  // ── Sondeo (lo usa el worker) ───────────────────────────────────────────────────────────────────────────────

  /**
   * «Comprobar ahora»: sondea un despliegue en este momento. Si ya se comprobó hace menos de `MIN_RECHECK_SECONDS` se
   * devuelve tal cual, para que el botón no sirva para martillear la API del asistente.
   */
  async probeNow(experimentId: string, deploymentId: string, prober: HealthProber): Promise<Deployment> {
    const deployment = await this.repo.getDeployment(experimentId, deploymentId);
    if (!deployment) throw new AssistantNotFoundError("Deployment");
    const recent = deployment.healthCheckedAt !== null && this.now().getTime() - new Date(deployment.healthCheckedAt).getTime() < MIN_RECHECK_SECONDS * 1000;
    if (recent) return deployment;
    await this.repo.recordProbe(deploymentId, await prober.probe(resolveHealthUrl(deployment)), this.now());
    return (await this.repo.getDeployment(experimentId, deploymentId))!;
  }

  /**
   * Habla con el agente en un entorno (ADR-055): URL = host del despliegue + path del agente, mensaje traducido a su
   * contrato. Solo se admiten despliegues sin autenticación: MemTrace no guarda credenciales de los asistentes.
   */
  async chat(experimentId: string, deploymentId: string, input: { message: string; sessionId: string | null }, client: ChatClient): Promise<{ reply: string; sessionId: string | null; latencyMs: number }> {
    const message = input.message.trim();
    if (message === "" || message.length > MAX_CHAT_MESSAGE_LENGTH) throw new ValidationError("Invalid message", { message: `Must be 1-${MAX_CHAT_MESSAGE_LENGTH} characters` });
    const card = await this.getCard(experimentId);
    const deployment = await this.repo.getDeployment(experimentId, deploymentId);
    if (!deployment) throw new AssistantNotFoundError("Deployment");
    if (!card.chat) throw new AssistantInvariantError("This agent has no chat endpoint configured");
    if (deployment.authMethod !== "none") throw new AssistantInvariantError("Chat is only available for deployments without authentication");

    const result = await client.send(resolveChatUrl(deployment, card.chat), buildChatRequest(card.chat, message, input.sessionId));
    if (result.error !== null || result.httpStatus === null) throw new AssistantUpstreamError(`The agent did not respond: ${result.error ?? "no response"}`);
    if (result.httpStatus < 200 || result.httpStatus >= 300) throw new AssistantUpstreamError(`The agent answered with HTTP ${result.httpStatus}`);
    const parsed = parseChatResponse(card.chat, result.body);
    if (parsed.reply === null) throw new AssistantUpstreamError(`The agent's response has no text in "${card.chat.responseField}"`);
    return { reply: parsed.reply, sessionId: parsed.sessionId ?? input.sessionId, latencyMs: result.latencyMs ?? 0 };
  }

  dueProbes(limit: number): Promise<ProbeTarget[]> {
    return this.repo.listDueDeployments(this.now(), limit);
  }

  recordProbe(deploymentId: string, result: ProbeResult): Promise<{ previous: HealthStatus; current: HealthStatus } | null> {
    return this.repo.recordProbe(deploymentId, result, this.now());
  }

  pruneHealthHistory(): Promise<number> {
    return this.repo.pruneHealthChecks(new Date(this.now().getTime() - HEALTH_RETENTION_DAYS * DAY_MS));
  }

  // ── Conexiones ──────────────────────────────────────────────────────────────────────────────────────────────

  /** Conexiones registradas con el uso observado de las tools (últimos 7 días). MCP y agentes aún sin medir (`usage: null`). */
  async listConnections(experimentId: string, serviceName: string): Promise<ConnectionWithUsage[]> {
    const to = this.now();
    const [connections, usage] = await Promise.all([
      this.repo.listConnections(experimentId),
      this.toolUsage.toolUsage(serviceName, new Date(to.getTime() - OBSERVATION_WINDOW_DAYS * DAY_MS), to),
    ]);
    const byTool = new Map(usage.map((u) => [u.tool, u]));
    return connections.map((c) => {
      const u = c.kind === "tool" ? byTool.get(c.name) : undefined;
      return { ...c, usage: c.kind === "tool" ? { calls: u?.calls ?? 0, errors: u?.errors ?? 0 } : null };
    });
  }

  /** Registra en el catálogo las tools vistas en trazas (nuevas como `pending`). Idempotente; lo llamará también un job periódico. */
  async syncObservedConnections(experimentId: string, serviceName: string): Promise<{ observed: number }> {
    await this.getCard(experimentId);
    const to = this.now();
    const usage = await this.toolUsage.toolUsage(serviceName, new Date(to.getTime() - OBSERVATION_WINDOW_DAYS * DAY_MS), to);
    const seen = usage.filter((u) => u.calls > 0).map((u) => ({ kind: "tool" as const, name: u.tool }));
    await this.repo.recordObservedConnections(experimentId, seen, to);
    return { observed: seen.length };
  }

  /** Sincroniza las tools observadas de todos los experimentos activos. Un fallo en uno (p. ej. ClickHouse) no detiene a los demás. */
  async syncAllObservedConnections(): Promise<{ experiments: number; observed: number; failed: number }> {
    const experiments = await this.repo.listActiveExperiments();
    let observed = 0;
    let failed = 0;
    for (const e of experiments) {
      try {
        observed += (await this.syncObservedConnections(e.experimentId, e.serviceName)).observed;
      } catch (error) {
        failed++;
        console.error(`[observed-sync] ${e.experimentId}:`, error);
      }
    }
    return { experiments: experiments.length, observed, failed };
  }

  async declareConnection(experimentId: string, input: DeclaredConnection): Promise<Connection> {
    validateDeclaredConnection(input);
    if (input.peerExperimentId === experimentId) throw new AssistantInvariantError("An assistant cannot be its own peer");
    await this.getCard(experimentId);
    return this.repo.declareConnection(experimentId, input);
  }

  async undeclareConnection(experimentId: string, connectionId: string): Promise<void> {
    if (!(await this.repo.undeclareConnection(experimentId, connectionId))) throw new AssistantNotFoundError("Connection");
  }

  async decideConnection(experimentId: string, connectionId: string, status: ConnectionStatus, decidedBy: string, note: string | null): Promise<Connection> {
    const connection = await this.repo.decideConnection(experimentId, connectionId, status, decidedBy, note);
    if (!connection) throw new AssistantNotFoundError("Connection");
    return connection;
  }

  // ── Accesos ─────────────────────────────────────────────────────────────────────────────────────────────────

  async listGrants(experimentId: string, deploymentId: string): Promise<AccessGrant[]> {
    const grants = await this.repo.listGrants(experimentId, deploymentId);
    if (!grants) throw new AssistantNotFoundError("Deployment");
    return grants;
  }

  async addGrant(experimentId: string, deploymentId: string, grant: NewGrant, createdBy: string): Promise<AccessGrant> {
    validateNewGrant(grant);
    const created = await this.repo.addGrant(experimentId, deploymentId, grant, createdBy);
    if (!created) throw new AssistantNotFoundError("Deployment");
    return created;
  }

  async removeGrant(experimentId: string, deploymentId: string, grantId: string): Promise<void> {
    if (!(await this.repo.removeGrant(experimentId, deploymentId, grantId))) throw new AssistantNotFoundError("Access grant");
  }
}
