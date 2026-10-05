import { SPAN_COLORS, spanBg } from "./palette";

export interface Meta {
  label: string;
  icon: string;
  color: string;
}

// colores del diseño; `bg` es el fondo suave de la insignia
const KINDS: Record<string, Meta> = {
  agent: { label: "Agent", icon: "smart_toy", color: SPAN_COLORS.agent },
  llm: { label: "LLM", icon: "psychology", color: SPAN_COLORS.llm },
  tool: { label: "Tool", icon: "build", color: SPAN_COLORS.tool },
  chain: { label: "Chain", icon: "link", color: SPAN_COLORS.chain },
  retriever: { label: "Retriever", icon: "search", color: SPAN_COLORS.retriever },
  embedding: { label: "Embedding", icon: "hub", color: SPAN_COLORS.embedding },
};

export function kindMeta(kind: string): Meta & { bg: string } {
  const meta = KINDS[kind] ?? { label: kind === "unknown" ? "Other" : kind, icon: "circle", color: SPAN_COLORS.unknown };
  return { ...meta, bg: spanBg(meta.color) };
}
