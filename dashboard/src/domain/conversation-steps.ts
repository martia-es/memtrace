import type { SpanNodeDto } from "@contract";
import { humanizeName } from "./review-thread";
import { spanIo } from "./span-io";
import { isGuardrailBlock, isGuardrailSpan } from "./trace-summary";
import { tr } from "./translate";

export interface StepChunk {
  rank: number;
  text: string;
  source: string | null;
  score: number | null;
}

export interface StepField {
  key: string;
  value: string;
}

interface StepBase {
  spanId: string;
  durationMs: number;
  failed: boolean;
  error: string | null;
}

/**
 * What the assistant did to build a reply, in the words a business reader uses: the guardrails it passed,
 * the passages it retrieved, the tools it called and the reply it wrote. Read from the span tree; nothing new is stored.
 */
export type ConversationStep =
  | (StepBase & { kind: "guardrails"; checks: { spanId: string; name: string; failed: boolean }[] })
  | (StepBase & { kind: "retrieval"; query: string | null; chunks: StepChunk[] })
  | (StepBase & { kind: "tool"; name: string; label: string; asked: StepField[]; returned: StepField[]; returnedText: string | null })
  | (StepBase & { kind: "reply"; model: string | null; tokens: number | null; costUsd: number | null });

const MAX_FIELDS = 8;
const MAX_VALUE = 160;

const clip = (text: string): string => (text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE - 1)}…` : text);
const show = (v: unknown): string => (v === null || v === undefined ? "–" : clip(typeof v === "object" ? JSON.stringify(v) : String(v)));

/** A JSON object as label/value rows ("days: 7"); null when it is not an object. */
export function fieldsOf(json: string): StepField[] | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return Object.entries(parsed as Record<string, unknown>)
      .slice(0, MAX_FIELDS)
      .map(([key, value]) => ({ key: key.replace(/_/g, " "), value: show(value) }));
  } catch {
    return null;
  }
}

function chunksOf(node: SpanNodeDto): StepChunk[] {
  const raw = node.attributes["memtrace.retriever.chunks"];
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((c, i) => {
      if (!c || typeof c !== "object") return [];
      const o = c as { text?: unknown; source?: unknown; id?: unknown; score?: unknown };
      const source = typeof o.source === "string" ? o.source : typeof o.id === "string" ? o.id : null;
      return [{ rank: i + 1, text: typeof o.text === "string" ? o.text : "", source, score: typeof o.score === "number" ? o.score : null }];
    });
  } catch {
    return [];
  }
}

function queryOf(node: SpanNodeDto): string | null {
  const blocks = spanIo(node).input;
  const named = blocks.find((b) => /query|question|text|input/i.test(b.label));
  const text = (named ?? blocks[0])?.text.trim();
  return text ? text : null;
}

const base = (node: SpanNodeDto): StepBase => ({
  spanId: node.spanId,
  durationMs: node.durationMs,
  failed: node.status.code === "error",
  error: node.status.code === "error" ? node.status.message || tr("conversation-steps.the_step_ended_with_an_error") : null,
});

function* walk(roots: SpanNodeDto[]): Generator<SpanNodeDto> {
  const stack = [...roots].reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    yield node;
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!);
  }
}

const hasDescendantOfKind = (node: SpanNodeDto, kind: string): boolean => [...walk(node.children)].some((n) => n.kind === kind);
const requestsTools = (node: SpanNodeDto): boolean => spanIo(node).output.some((b) => (b.calls?.length ?? 0) > 0);

export function conversationSteps(roots: SpanNodeDto[]): ConversationStep[] {
  const steps: ConversationStep[] = [];
  // the model call that wrote the reply is the last one, and only if it did not ask for another tool
  const lastModelCall = [...walk(roots)].filter((n) => n.kind === "llm").at(-1);
  let guardrails: Extract<ConversationStep, { kind: "guardrails" }> | null = null;

  const visit = (node: SpanNodeDto): void => {
    if (isGuardrailSpan(node)) {
      if (!guardrails) {
        guardrails = { ...base(node), kind: "guardrails", checks: [] };
        steps.push(guardrails);
      }
      guardrails.durationMs += guardrails.spanId === node.spanId ? 0 : node.durationMs;
      if (isGuardrailBlock(node)) {
        guardrails.failed = true;
        const check = node.attributes["guardrail.check"];
        guardrails.error = check ? tr("conversation-steps.blocked_by_the_check_check", { check: humanizeName(check).toLowerCase() }) : tr("conversation-steps.the_message_was_blocked");
      } else {
        const failed = node.status.code === "error";
        if (failed) {
          guardrails.failed = true;
          guardrails.error = guardrails.error ?? (node.status.message || tr("conversation-steps.a_check_failed"));
        }
        guardrails.checks.push({ spanId: node.spanId, name: humanizeName(node.name.replace(/^guardrail\./, "")), failed });
      }
      return;
    }
    if (node.kind === "retriever") {
      steps.push({ ...base(node), kind: "retrieval", query: queryOf(node), chunks: chunksOf(node) });
      return;
    }
    if (node.kind === "tool" && !hasDescendantOfKind(node, "retriever")) {
      const io = spanIo(node);
      const name = node.genAi?.toolName ?? node.name.replace(/^execute_tool\s+/, "");
      const returned = fieldsOf(io.outputJson);
      steps.push({
        ...base(node),
        kind: "tool",
        name,
        label: humanizeName(name),
        asked: fieldsOf(io.inputJson) ?? [],
        returned: returned ?? [],
        returnedText: returned ? null : (io.output[0]?.text.trim() || null),
      });
      return;
    }
    if (node.kind === "llm") {
      if (node === lastModelCall && !requestsTools(node)) {
        const g = node.genAi;
        const tokens = g ? (g.totalTokens ?? (g.inputTokens ?? 0) + (g.outputTokens ?? 0)) : 0;
        steps.push({ ...base(node), kind: "reply", model: g?.responseModel ?? g?.requestModel ?? null, tokens: tokens || null, costUsd: node.costUsd });
      }
      return;
    }
    for (const child of node.children) visit(child);
  };
  for (const root of roots) visit(root);
  return steps;
}
