import type { AssistantCardDto, DeploymentSummaryDto, PromptUsageDto, SpanNodeDto } from "@contract";
import { traceThread } from "./trace-thread";

/**
 * Lo que el playground (ADR-071) necesita decidir antes de ejecutar: dónde puede probarse una versión y qué mensaje
 * reejecutar de una traza. Reglas puras de presentación.
 */

export interface PlaygroundTarget {
  deployment: DeploymentSummaryDto;
  label: string;
}

export interface PlaygroundTargets {
  /** despliegues donde se puede probar: no son de producción y no piden credenciales */
  usable: PlaygroundTarget[];
  /** por qué no hay ninguno, en una frase; null si hay alguno */
  unavailable: string | null;
}

export function playgroundTargets(card: Pick<AssistantCardDto, "chat" | "deployments">): PlaygroundTargets {
  if (!card.chat) return { usable: [], unavailable: "This agent has no chat endpoint configured. Add one in the assistant's card to talk to it from here." };
  const usable = [...card.deployments]
    .filter((d) => !d.environment.isProduction && d.authMethod === "none")
    .sort((a, b) => a.environment.position - b.environment.position)
    .map((deployment) => ({ deployment, label: `${deployment.environment.label} · ${deployment.apiUrl}` }));
  if (usable.length > 0) return { usable, unavailable: null };
  const nonProduction = card.deployments.filter((d) => !d.environment.isProduction);
  return {
    usable,
    unavailable:
      nonProduction.length === 0
        ? "The playground never runs against production, and this agent has no other environment."
        : "The agent's non-production environments need credentials, and MemTrace does not store them, so it cannot talk to them.",
  };
}

/** ¿Algún agente ha informado de leer este prompt en el entorno? Sin eso, lo normal es que el agente ignore el override. */
export function agentReadsPrompt(usage: PromptUsageDto[], environmentKey: string): boolean {
  return usage.some((u) => u.active && u.environment === environmentKey);
}

export interface ReplayInput {
  /** el mensaje de la persona en esa traza; null si no hay (¿sin captura de contenido?) */
  message: string | null;
  /** lo que contestó el agente entonces */
  answer: string | null;
}

/** El mensaje que se reejecuta y la respuesta original de una traza: el último mensaje de usuario y la última respuesta con texto. */
export function replayInputOf(roots: SpanNodeDto[]): ReplayInput {
  const blocks = traceThread(roots).filter((b) => b.text.trim() !== "");
  const lastOf = (role: string) => [...blocks].reverse().find((b) => b.role === role)?.text.trim() ?? null;
  return { message: lastOf("user"), answer: lastOf("assistant") };
}

const NAME = "memtrace.prompt.name";
const VERSION = "memtrace.prompt.version";

/** Los prompts del registro que usó una traza (marcados por el SDK, ADR-068), sin repetir. Vacío si no usa el registro. */
export function promptsUsedBy(roots: SpanNodeDto[]): Array<{ name: string; version: number }> {
  const found = new Map<string, number>();
  const visit = (node: SpanNodeDto) => {
    const name = node.attributes?.[NAME];
    const version = Number(node.attributes?.[VERSION]);
    if (name && Number.isInteger(version) && version > 0) found.set(name, version);
    for (const child of node.children ?? []) visit(child);
  };
  roots.forEach(visit);
  return [...found].map(([name, version]) => ({ name, version }));
}
