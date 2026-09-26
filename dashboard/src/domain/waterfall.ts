import type { SpanNodeDto } from "@contract";

export interface WaterfallRow {
  node: SpanNodeDto;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
  /** posición y ancho de la barra, en % de la duración total de la traza */
  leftPct: number;
  widthPct: number;
}

const MIN_BAR_PCT = 0.4;

/** Aplana el árbol en filas de la cascada (recorrido en profundidad, iterativo). */
export function buildRows(roots: SpanNodeDto[], totalMs: number, collapsed: ReadonlySet<string>): WaterfallRow[] {
  const total = totalMs > 0 ? totalMs : 1;
  const rows: WaterfallRow[] = [];
  const stack: { node: SpanNodeDto; depth: number }[] = [...roots].reverse().map((node) => ({ node, depth: 0 }));

  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    const isCollapsed = collapsed.has(node.spanId);
    const leftPct = clamp((node.offsetMs / total) * 100, 0, 100 - MIN_BAR_PCT);
    const widthPct = clamp((node.durationMs / total) * 100, MIN_BAR_PCT, 100 - leftPct);
    rows.push({ node, depth, hasChildren: node.children.length > 0, collapsed: isCollapsed, leftPct, widthPct });
    if (!isCollapsed) {
      for (let i = node.children.length - 1; i >= 0; i--) stack.push({ node: node.children[i]!, depth: depth + 1 });
    }
  }
  return rows;
}

export function parentIds(roots: SpanNodeDto[]): string[] {
  const ids: string[] = [];
  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.children.length > 0) {
      ids.push(node.spanId);
      stack.push(...node.children);
    }
  }
  return ids;
}

export function findNode(roots: SpanNodeDto[], spanId: string): SpanNodeDto | null {
  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.spanId === spanId) return node;
    stack.push(...node.children);
  }
  return null;
}

/** Primer span (en orden de la traza) que terminó con error; null si no hay ninguno. */
export function firstErrorNode(roots: SpanNodeDto[]): SpanNodeDto | null {
  const stack = [...roots].reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.status.code === "error") return node;
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!);
  }
  return null;
}

/** Ids de los ancestros de un span: para expandirlos si se enlaza directamente a un span interno. */
export function ancestorIds(roots: SpanNodeDto[], spanId: string): string[] {
  const parentOf = new Map<string, string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const child of node.children) {
      parentOf.set(child.spanId, node.spanId);
      stack.push(child);
    }
  }
  const chain: string[] = [];
  for (let id = parentOf.get(spanId); id !== undefined; id = parentOf.get(id)) chain.push(id);
  return chain;
}

export function axisTicks(totalMs: number, count = 4): { pct: number; ms: number }[] {
  return Array.from({ length: count + 1 }, (_, i) => ({ pct: (i / count) * 100, ms: (totalMs * i) / count }));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
