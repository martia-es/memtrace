import type { StatusCodeDto } from "@contract";
import { SPAN_COLORS, SPAN_BG_COLORS } from "./palette";

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
  agent: { label: "Agente", icon: "smart_toy", color: SPAN_COLORS.agent, bg: SPAN_BG_COLORS.agent },
  llm: { label: "LLM", icon: "psychology", color: SPAN_COLORS.llm, bg: SPAN_BG_COLORS.llm },
  tool: { label: "Herramienta", icon: "build", color: SPAN_COLORS.tool, bg: SPAN_BG_COLORS.tool },
  chain: { label: "Cadena", icon: "link", color: SPAN_COLORS.chain, bg: SPAN_BG_COLORS.chain },
  retriever: { label: "Retriever", icon: "search", color: SPAN_COLORS.retriever, bg: SPAN_BG_COLORS.retriever },
  embedding: { label: "Embedding", icon: "hub", color: SPAN_COLORS.embedding, bg: SPAN_BG_COLORS.embedding },
};

export function kindMeta(kind: string): Meta & { bg: string } {
  return KINDS[kind] ?? { label: kind === "unknown" ? "Otro" : kind, icon: "circle", color: SPAN_COLORS.unknown, bg: SPAN_BG_COLORS.unknown };
}
