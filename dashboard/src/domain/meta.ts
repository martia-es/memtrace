import type { StatusCodeDto } from "@contract";

export interface Meta {
  label: string;
  icon: string;
  color: string;
}

export function statusMeta(code: StatusCodeDto): Meta {
  switch (code) {
    case "ok":
      return { label: "Correcto", icon: "check_circle", color: "positive" };
    case "error":
      return { label: "Error", icon: "error", color: "negative" };
    default:
      return { label: "Sin estado", icon: "help_outline", color: "grey" };
  }
}

const KINDS: Record<string, Meta> = {
  agent: { label: "Agente", icon: "smart_toy", color: "#6d5bd0" },
  llm: { label: "LLM", icon: "psychology", color: "#0e8f7e" },
  tool: { label: "Herramienta", icon: "build", color: "#d9822b" },
  chain: { label: "Cadena", icon: "link", color: "#4b7bd1" },
  retriever: { label: "Retriever", icon: "search", color: "#b0489a" },
  embedding: { label: "Embedding", icon: "hub", color: "#8a6d3b" },
};

export function kindMeta(kind: string): Meta {
  return KINDS[kind] ?? { label: kind === "unknown" ? "Otro" : kind, icon: "circle", color: "#7a8699" };
}
