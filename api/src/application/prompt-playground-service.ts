import type { ChatClient } from "@/application/ports/chat-client";
import type { PromptRepository } from "@/application/ports/prompt-repository";
import { hashOverrideToken, newOverrideToken } from "@/application/prompt-service";
import type { AssistantRegistryService } from "@/application/assistant-registry-service";
import { AssistantInvariantError, AssistantNotFoundError, AssistantUpstreamError, PromptInvariantError, PromptNotFoundError, ValidationError } from "@/domain/errors";
import { MAX_PLAYGROUND_HISTORY, MAX_PLAYGROUND_MESSAGE, OVERRIDE_TTL_SECONDS, PROMPT_OVERRIDE_HEADER, type Prompt } from "@/domain/prompt";

export interface PlaygroundResult {
  reply: string;
  sessionId: string | null;
  /** traza de esta respuesta, si el agente la devuelve (`traceIdField`) */
  traceId: string | null;
  latencyMs: number;
  /** la versión que se probó */
  version: number;
  /**
   * ¿Aplicó el agente el override? Lo sabemos con certeza: el SDK presenta el token a MemTrace para obtener la versión, y
   * esa presentación queda contada. `false` = el agente respondió sin pedir la versión (no lee el prompt con
   * `memtrace.prompts`, el override está desactivado o no lee la cabecera): la respuesta NO es de la versión probada.
   */
  applied: boolean;
}

/**
 * Playground contra el asistente real (ADR-071): ejecuta una versión de un prompt en el agente de verdad —con sus tools, su
 * RAG y su memoria— sin mover ningún tag. MemTrace llama al chat del agente (ADR-055) con un token efímero en una cabecera;
 * el SDK del agente lo presenta a MemTrace para obtener esa versión solo para esa petición.
 */
export class PromptPlaygroundService {
  constructor(
    private readonly prompts: PromptRepository,
    private readonly registry: Pick<AssistantRegistryService, "getCard" | "chat">,
    private readonly chat: ChatClient,
  ) {}

  async run(prompt: Prompt, experimentId: string, userId: string, input: { deploymentId: string; version: number; message: string; history?: string[] }): Promise<PlaygroundResult> {
    if (!prompt.experimentIds.includes(experimentId)) throw new PromptNotFoundError("Prompt for this agent");
    const message = input.message.trim();
    if (message === "" || message.length > MAX_PLAYGROUND_MESSAGE) throw new ValidationError("Invalid message", { message: `Must be 1-${MAX_PLAYGROUND_MESSAGE} characters` });
    const history = (input.history ?? []).map((h) => h.trim()).filter((h) => h !== "");
    if (history.length > MAX_PLAYGROUND_HISTORY || history.some((h) => h.length > MAX_PLAYGROUND_MESSAGE)) {
      throw new ValidationError("Invalid history", { history: `At most ${MAX_PLAYGROUND_HISTORY} messages of 1-${MAX_PLAYGROUND_MESSAGE} characters` });
    }
    if (!(await this.prompts.getVersion(prompt.id, input.version))) throw new PromptNotFoundError(`Version ${input.version}`);

    const card = await this.registry.getCard(experimentId);
    const deployment = card.deployments.find((d) => d.id === input.deploymentId);
    if (!deployment) throw new AssistantNotFoundError("Deployment");
    // el override cambia lo que dice el agente: en producción no se prueba, se promueve (ADR-070)
    if (deployment.environment.isProduction) throw new PromptInvariantError("The playground does not run against production environments");

    const token = newOverrideToken();
    const tokenHash = hashOverrideToken(token);
    await this.prompts.createOverride({ tokenHash, experimentId, promptId: prompt.id, version: input.version, userId, ttlSeconds: OVERRIDE_TTL_SECONDS * (history.length + 1) });

    // las vueltas anteriores se reproducen en la misma sesión del agente (ADR-075): el agente recuerda a su manera y MemTrace no inyecta contexto
    if (history.length > 0 && !card.chat?.sessionField) throw new AssistantInvariantError("This agent keeps no session, so earlier messages cannot be replayed. Configure a session field in its chat settings.");
    const headers = { [PROMPT_OVERRIDE_HEADER]: token };
    let sessionId: string | null = null;
    for (const earlier of history) {
      sessionId = (await this.registry.chat(experimentId, input.deploymentId, { message: earlier, sessionId, headers }, this.chat)).sessionId;
      if (sessionId === null) throw new AssistantUpstreamError("The agent did not return a session id, so the conversation cannot continue");
    }
    const answer = await this.registry.chat(experimentId, input.deploymentId, { message, sessionId, headers }, this.chat);
    return { ...answer, version: input.version, applied: (await this.prompts.overrideUses(tokenHash)) > 0 };
  }
}
