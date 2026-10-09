import type { PromptUsage } from "@/domain/prompt";

/** Lo que un agente declaró estar sirviendo de este prompt (ADR-068), con el entorno en el que corre. */
export interface AgentServing {
  environment: string;
  /** tag que sigue; vacío = pidió una versión fija */
  tag: string;
  version: number;
  lastSeenAt: string;
}

export interface AgentLink {
  experimentId: string;
  name: string;
  serving: AgentServing[];
}

/** Los usos informados, agrupados por agente enlazado (un uso de un agente ya desenlazado no es una dependencia). */
export function servingByAgent(agents: Array<{ experimentId: string; name: string }>, usage: PromptUsage[]): AgentLink[] {
  return agents.map((a) => ({
    ...a,
    serving: usage
      .filter((u) => u.experimentId === a.experimentId)
      .map((u) => ({ environment: u.environment, tag: u.tag, version: u.version, lastSeenAt: u.lastSeenAt }))
      .sort((x, y) => x.environment.localeCompare(y.environment)),
  }));
}

export interface AgentImpact {
  experimentId: string;
  name: string;
  environment: string;
  from: number;
  to: number;
  /** false si ya está en esa versión: el agente no notará nada */
  changes: boolean;
}

export interface PromotionImpact {
  tag: string;
  toVersion: number;
  /** agentes que siguen ese tag y recibirán la versión nueva en su próxima consulta */
  agents: AgentImpact[];
  /** agentes enlazados que piden una versión fija: este movimiento no les afecta */
  pinned: number;
  /** si es un fragmento: prompts que lo incluyen con ese tag y se quedarán atrás (nada cambia hasta reconstruirlos) */
  willBeBehind: Array<{ promptId: string; name: string }>;
}

/** Qué cambia, y a quién, si `tag` pasa a `toVersion`. Solo lee: no mueve nada. */
export function promotionImpact(input: {
  tag: string;
  toVersion: number;
  agents: AgentLink[];
  /** prompts que incluyen este fragmento y los tags/números con los que lo referencian */
  dependents: Array<{ promptId: string; name: string; refs: string[] }>;
  /** versión a la que apunta el tag ahora; null si aún no existe */
  currentVersion: number | null;
}): PromotionImpact {
  const agents: AgentImpact[] = [];
  let pinned = 0;
  for (const agent of input.agents) {
    for (const s of agent.serving) {
      if (s.tag === "") pinned += 1;
      else if (s.tag === input.tag) agents.push({ experimentId: agent.experimentId, name: agent.name, environment: s.environment, from: s.version, to: input.toVersion, changes: s.version !== input.toVersion });
    }
  }
  const moves = input.currentVersion !== input.toVersion;
  return {
    tag: input.tag,
    toVersion: input.toVersion,
    agents,
    pinned,
    willBeBehind: moves ? input.dependents.filter((d) => d.refs.includes(input.tag)).map(({ promptId, name }) => ({ promptId, name })) : [],
  };
}
