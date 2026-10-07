import type { SpanNodeDto } from "@contract";
import { kindMeta } from "./meta";
import { SPAN_COLORS } from "./palette";

/** How a step is told apart in the timeline under a reply: guardrails are custom steps, the rest follow the span kind. */
export type StepGroup = "guardrail" | "llm" | "tool" | "other";

export interface TimelineStep {
  node: SpanNodeDto;
  group: StepGroup;
  label: string;
  color: string;
  /** position and width of the bar, in % of the whole turn */
  leftPct: number;
  widthPct: number;
  /** 0 = a step of the turn; 1 = a span directly inside that step */
  depth: 0 | 1;
  failed: boolean;
}

export interface Timeline {
  totalMs: number;
  /** the sequential steps of the turn, in order: the one-line view */
  phases: TimelineStep[];
  /** the steps followed by what ran inside each one: the expanded view */
  rows: TimelineStep[];
  slowest: TimelineStep | null;
}

const MIN_BAR_PCT = 0.6;

const isGuardrail = (node: SpanNodeDto) => /guardrail/i.test(node.kind) || /guardrail/i.test(node.name);

export function stepGroup(node: SpanNodeDto): StepGroup {
  if (isGuardrail(node)) return "guardrail";
  if (node.kind === "llm") return "llm";
  if (node.kind === "tool") return "tool";
  return "other";
}

export function stepColor(node: SpanNodeDto): string {
  const group = stepGroup(node);
  return group === "guardrail" ? SPAN_COLORS.guardrail : group === "other" ? kindMeta(node.kind).color : kindMeta(group).color;
}

/** "guardrail.regex_pii" → "regex_pii"; "LLM" spans keep the model name when there is one */
function labelOf(node: SpanNodeDto): string {
  if (node.kind === "llm") return node.genAi?.responseModel ?? node.genAi?.requestModel ?? node.name;
  if (node.kind === "tool") return node.genAi?.toolName ?? node.name;
  return node.name.replace(/^guardrail\./i, "");
}

/**
 * The sequential steps of a turn. Wrappers (the agent, a chain that only groups other steps) are looked through, so
 * what is left is what actually took time: guardrails, model calls, tools, retrievals. A guardrail stays one step even
 * though it is made of several checks.
 */
function phasesOf(roots: SpanNodeDto[]): SpanNodeDto[] {
  const phases: SpanNodeDto[] = [];
  const stack = [...roots].reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    const wrapper = node.children.length > 0 && !isGuardrail(node) && node.kind !== "llm" && node.kind !== "tool";
    if (wrapper) for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!);
    else phases.push(node);
  }
  return phases.sort((a, b) => a.offsetMs - b.offsetMs);
}

export function buildTimeline(roots: SpanNodeDto[], totalMs: number): Timeline {
  const total = totalMs > 0 ? totalMs : Math.max(1, ...roots.map((r) => r.offsetMs + r.durationMs));
  const step = (node: SpanNodeDto, depth: 0 | 1): TimelineStep => {
    const leftPct = Math.min(Math.max((node.offsetMs / total) * 100, 0), 100 - MIN_BAR_PCT);
    return {
      node,
      group: stepGroup(node),
      label: labelOf(node),
      color: stepColor(node),
      leftPct,
      widthPct: Math.min(Math.max((node.durationMs / total) * 100, MIN_BAR_PCT), 100 - leftPct),
      depth,
      failed: node.status.code === "error",
    };
  };
  const phases = phasesOf(roots).map((node) => step(node, 0));
  const rows = phases.flatMap((p) => [p, ...p.node.children.map((child) => step(child, 1))]);
  const slowest = phases.reduce<TimelineStep | null>((max, p) => (!max || p.node.durationMs > max.node.durationMs ? p : max), null);
  return { totalMs: total, phases, rows, slowest };
}
