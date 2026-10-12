import type { SpanNodeDto } from "@contract";

/** Spans opened by an input/output guardrail (`guardrail.length`, `guardrail.pii`…, ADR-026). */
export const isGuardrailSpan = (node: SpanNodeDto): boolean => node.kind.startsWith("guardrail") || node.name.startsWith("guardrail.");

/** `guardrail.blocked` is the empty span a check opens when it stops a message; it is not a check itself. */
export const isGuardrailBlock = (node: SpanNodeDto): boolean => node.name === "guardrail.blocked" || node.kind === "guardrail.blocked";

export type SpanFilter = "all" | "llm" | "tool" | "retriever" | "guardrail" | "error";

export const matchesFilter = (node: SpanNodeDto, filter: SpanFilter): boolean => {
  switch (filter) {
    case "all":
      return true;
    case "guardrail":
      return isGuardrailSpan(node);
    case "error":
      return node.status.code === "error";
    default:
      return node.kind === filter;
  }
};

export interface TraceSummary {
  spans: number;
  modelCalls: number;
  tools: number;
  retrievals: number;
  guardrails: { total: number; failed: number };
  errors: number;
  /** the slowest model call, tool or retrieval: the step worth looking at first */
  slowest: { spanId: string; name: string; durationMs: number; share: number } | null;
}

function* walk(roots: SpanNodeDto[]): Generator<SpanNodeDto> {
  const stack = [...roots].reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    yield node;
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!);
  }
}

export function traceSummary(roots: SpanNodeDto[], totalMs: number): TraceSummary {
  const s: TraceSummary = { spans: 0, modelCalls: 0, tools: 0, retrievals: 0, guardrails: { total: 0, failed: 0 }, errors: 0, slowest: null };
  for (const node of walk(roots)) {
    s.spans++;
    if (node.status.code === "error") s.errors++;
    if (isGuardrailSpan(node)) {
      if (isGuardrailBlock(node)) s.guardrails.failed++;
      else {
        s.guardrails.total++;
        if (node.status.code === "error") s.guardrails.failed++;
      }
      continue;
    }
    if (node.kind === "llm") s.modelCalls++;
    else if (node.kind === "tool") s.tools++;
    else if (node.kind === "retriever") s.retrievals++;
    else continue;
    if (!s.slowest || node.durationMs > s.slowest.durationMs) {
      s.slowest = { spanId: node.spanId, name: node.name, durationMs: node.durationMs, share: totalMs > 0 ? node.durationMs / totalMs : 0 };
    }
  }
  return s;
}

export interface GuardrailGroup {
  total: number;
  failed: number;
}

/**
 * Spans whose children are all guardrail checks (`input_guardrail`), keyed by span id: the waterfall folds them into one
 * row ("3 checks passed") instead of one row per check. A group with a failed check is never folded by default.
 */
export function guardrailGroups(roots: SpanNodeDto[]): Map<string, GuardrailGroup> {
  const groups = new Map<string, GuardrailGroup>();
  for (const node of walk(roots)) {
    if (node.children.length === 0 || isGuardrailSpan(node) || !node.children.every(isGuardrailSpan)) continue;
    const checks = node.children.filter((c) => !isGuardrailBlock(c));
    groups.set(node.spanId, { total: checks.length, failed: node.children.filter((c) => isGuardrailBlock(c) || c.status.code === "error").length });
  }
  return groups;
}
