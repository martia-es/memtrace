import { detectFramework } from "./framework";
import { extractContent, extractGenAi, extractKind, remainingAttributes, tokensOf } from "./genai";
import type { Span, SpanNode } from "./span";
import type { StatusCode } from "./span";
import type { TraceDetail } from "./trace";

const byStartThenId = (a: Span, b: Span) =>
  a.startTimeUs - b.startTimeUs || (a.spanId < b.spanId ? -1 : a.spanId > b.spanId ? 1 : 0);

export interface SpanTree {
  roots: SpanNode[];
  /** todos los nodos, sin repetir */
  nodes: SpanNode[];
}

/**
 * Reconstruye el árbol de ejecución desde `parentSpanId`.
 *  1. Deduplica por `spanId` (los reintentos del collector pueden insertar un span dos veces).
 *  2. Un span sin padre, o con un padre ausente, es raíz (`orphan` si el padre se referencia pero falta).
 *  3. Hijos ordenados por (inicio, spanId): resultado determinista.
 *  4. Los ciclos de padres (datos corruptos) se rompen convirtiendo un span del ciclo en raíz.
 *  5. Iterativo: los bucles anidados de un agente no desbordan la pila.
 */
export function buildSpanTree(spans: Span[], traceStartUs: number): SpanTree {
  const byId = new Map<string, Span>();
  for (const span of spans) if (!byId.has(span.spanId)) byId.set(span.spanId, span);
  const unique = [...byId.values()].sort(byStartThenId);

  const childrenOf = new Map<string, Span[]>();
  const rootSpans: Span[] = [];
  for (const span of unique) {
    if (span.parentSpanId !== null && byId.has(span.parentSpanId)) {
      const siblings = childrenOf.get(span.parentSpanId) ?? [];
      siblings.push(span);
      childrenOf.set(span.parentSpanId, siblings);
    } else {
      rootSpans.push(span);
    }
  }

  const nodes: SpanNode[] = [];
  const visited = new Set<string>();

  const toNode = (span: Span, orphan: boolean): SpanNode => {
    const node: SpanNode = {
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      name: span.name,
      kind: extractKind(span.attributes),
      serviceName: span.serviceName,
      startTimeUs: span.startTimeUs,
      offsetMs: (span.startTimeUs - traceStartUs) / 1000,
      durationMs: span.durationMs,
      status: span.status,
      orphan,
      genAi: extractGenAi(span.attributes),
      content: extractContent(span.attributes),
      framework: detectFramework(span.scopeName, span.attributes),
      attributes: remainingAttributes(span.attributes),
      events: span.events,
      children: [],
    };
    nodes.push(node);
    return node;
  };

  const attach = (root: Span, orphan: boolean): SpanNode => {
    const rootNode = toNode(root, orphan);
    visited.add(root.spanId);
    const stack: SpanNode[] = [rootNode];
    while (stack.length > 0) {
      const parent = stack.pop()!;
      for (const child of childrenOf.get(parent.spanId) ?? []) {
        if (visited.has(child.spanId)) continue;
        visited.add(child.spanId);
        const node = toNode(child, false);
        parent.children.push(node);
        stack.push(node);
      }
    }
    return rootNode;
  };

  const roots = rootSpans.map((span) => attach(span, span.parentSpanId !== null));
  // Lo no alcanzado desde ninguna raíz forma un ciclo de padres: se rompe por el span más antiguo
  for (const span of unique) {
    if (!visited.has(span.spanId)) roots.push(attach(span, true));
  }
  return { roots, nodes };
}

function rootStatus(roots: SpanNode[]): StatusCode {
  const real = roots.filter((r) => r.parentSpanId === null);
  if (real.some((r) => r.status.code === "error")) return "error";
  if (real.some((r) => r.status.code === "ok")) return "ok";
  return "unset";
}

/** La conversación la declara el span raíz; si no, cualquier span que la lleve. */
function conversationOf(roots: SpanNode[], nodes: SpanNode[]): string | null {
  const key = "gen_ai.conversation.id";
  const pick = (list: SpanNode[]) => list.map((n) => n.attributes[key]).find((v) => v !== undefined && v !== "");
  return pick(roots.filter((r) => r.parentSpanId === null)) ?? pick(nodes) ?? null;
}

/** El framework lo declara el span raíz; si no, cualquier span en el que se haya detectado. */
function frameworkOf(roots: SpanNode[], nodes: SpanNode[]): string | null {
  const pick = (list: SpanNode[]) => list.map((n) => n.framework).find((v) => v !== null);
  return pick(roots.filter((r) => r.parentSpanId === null)) ?? pick(nodes) ?? null;
}

/** Construye el detalle de una traza (árbol + agregados) a partir de sus spans planos. */
export function buildTraceDetail(traceId: string, spans: Span[], truncated: boolean): TraceDetail {
  const startTimeUs = spans.reduce((min, s) => Math.min(min, s.startTimeUs), Infinity);
  const { roots, nodes } = buildSpanTree(spans, startTimeUs);
  const endUs = nodes.reduce((max, n) => Math.max(max, n.startTimeUs + n.durationMs * 1000), startTimeUs);

  let errorCount = 0;
  let totalTokens = 0;
  for (const node of nodes) {
    if (node.status.code === "error") errorCount += 1;
    // Solo `chat`: evita contar dos veces si un framework repite el uso en spans padre (ADR-009)
    if (node.genAi?.operation === "chat") totalTokens += tokensOf(node.genAi);
  }

  return {
    traceId,
    conversationId: conversationOf(roots, nodes),
    framework: frameworkOf(roots, nodes),
    startTimeUs,
    durationMs: (endUs - startTimeUs) / 1000,
    status: rootStatus(roots),
    spanCount: nodes.length,
    errorCount,
    totalTokens,
    truncated,
    roots,
  };
}
