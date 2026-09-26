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

// colores del diseño; `bg` es el fondo suave de la insignia
const KINDS: Record<string, Meta & { bg: string }> = {
  agent: { label: "Agente", icon: "smart_toy", color: "#b8c4bc", bg: "#edf1ee" },
  llm: { label: "LLM", icon: "psychology", color: "#7a5af8", bg: "#ede8ff" },
  tool: { label: "Herramienta", icon: "build", color: "#ff8a3d", bg: "#ffe9d9" },
  chain: { label: "Cadena", icon: "link", color: "#4b7bd1", bg: "#e3ecfb" },
  retriever: { label: "Retriever", icon: "search", color: "#2fb5d6", bg: "#ddf3fa" },
  embedding: { label: "Embedding", icon: "hub", color: "#1fb5a0", bg: "#ddf5f1" },
};

export function kindMeta(kind: string): Meta & { bg: string } {
  return KINDS[kind] ?? { label: kind === "unknown" ? "Otro" : kind, icon: "circle", color: "#9aa79f", bg: "#eef2ef" };
}
