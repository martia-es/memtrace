import { messageBlocks, type IoBlock } from "./span-io";

/** A dataset cell that holds a chat (list of messages) shown as readable text; the stored JSON is never rewritten from it. */
export interface ConversationPreview {
  /** number of messages in the stored list */
  count: number;
  /** one line for the grid: the last user message for an input, the last assistant message for an expected output */
  summary: string;
  blocks: IoBlock[];
}

export type CellSide = "input" | "expected";

const WANTED: Record<CellSide, IoBlock["role"]> = { input: "user", expected: "assistant" };

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * `text` is the cell as the draft keeps it (compact JSON for non-strings, see `toCellText`). Returns null for plain text,
 * for JSON that is not a list of `{ role, … }` messages, and for formats no adapter in `span-io` understands: the cell then stays editable as it is today.
 */
export function conversationPreview(text: string, side: CellSide): ConversationPreview | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("[")) return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every((m) => m !== null && typeof m === "object" && !Array.isArray(m) && "role" in m)) return null;
  const blocks = messageBlocks(value);
  if (!blocks || blocks.length === 0) return null;
  const withText = blocks.filter((b) => b.text.trim());
  const pick = [...withText].reverse().find((b) => b.role === WANTED[side]) ?? withText[withText.length - 1];
  return { count: blocks.length, summary: pick ? oneLine(pick.text) : "", blocks };
}
