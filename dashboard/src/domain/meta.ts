import { SPAN_COLORS, spanBg } from "./palette";
import { tr } from "./translate";

export interface Meta {
  label: string;
  icon: string;
  color: string;
}

// colores del diseño; `bg` es el fondo suave de la insignia
const KINDS: Record<string, Meta> = {
  agent: { get label() { return tr("meta.agent"); }, icon: "smart_toy", color: SPAN_COLORS.agent },
  llm: { label: "LLM", icon: "psychology", color: SPAN_COLORS.llm },
  tool: { get label() { return tr("meta.tool"); }, icon: "build", color: SPAN_COLORS.tool },
  chain: { get label() { return tr("meta.chain"); }, icon: "link", color: SPAN_COLORS.chain },
  retriever: { get label() { return tr("meta.retriever"); }, icon: "search", color: SPAN_COLORS.retriever },
  embedding: { get label() { return tr("meta.embedding"); }, icon: "hub", color: SPAN_COLORS.embedding },
};

export function kindMeta(kind: string): Meta & { bg: string } {
  const meta = KINDS[kind] ?? { label: kind === "unknown" ? tr("meta.other") : kind, icon: "circle", color: SPAN_COLORS.unknown };
  return { ...meta, bg: spanBg(meta.color) };
}
