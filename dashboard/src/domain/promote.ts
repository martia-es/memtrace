import type { SpanNodeDto } from "@contract";

/** Preview of what "Add to dataset" will copy from a trace (ADR-038): same rule as the server — input of the first span that has it, output of the last to finish. */
export interface FixtureDraft {
  input: string;
  observedOutput: string | null;
}

const isPresent = (v: unknown): boolean => v !== undefined && v !== null && (typeof v !== "string" || v.trim() !== "");
const asText = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v, null, 2));

function flatten(roots: SpanNodeDto[]): SpanNodeDto[] {
  return roots.flatMap((n) => [n, ...flatten(n.children)]);
}

/** null when no span captured input: the server would skip the trace as `no_content` unless the person types one. */
export function fixtureDraftOf(roots: SpanNodeDto[]): FixtureDraft | null {
  const nodes = flatten(roots).filter((n) => n.content);
  const startMs = (n: SpanNodeDto) => Date.parse(n.startTime);
  const endMs = (n: SpanNodeDto) => startMs(n) + n.durationMs;
  const first = [...nodes].sort((a, b) => startMs(a) - startMs(b)).find((n) => isPresent(n.content!.input ?? n.content!.inputMessages));
  if (!first) return null;
  const last = [...nodes].sort((a, b) => endMs(b) - endMs(a)).find((n) => isPresent(n.content!.output ?? n.content!.outputMessages));
  return { input: asText(first.content!.input ?? first.content!.inputMessages), observedOutput: last ? asText(last.content!.output ?? last.content!.outputMessages) : null };
}

/** What the person typed -> what is stored: JSON if it parses, otherwise the plain string (same convention as the server). */
export function parseFixtureText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
