import type { IoBlock, ToolCall } from "./span-io";
import { tr } from "./translate";

/** What a business reviewer sees: the conversation without ids, raw JSON or system prompts. */
export type Turn =
  | { kind: "user"; text: string }
  | { kind: "message"; text: string }
  | { kind: "answer"; text: string }
  | { kind: "action"; summary: string }
  | { kind: "data"; source: string | null; json: string }
  /** consecutive tool calls and their data folded into one row (only `foldForReview` produces it) */
  | { kind: "steps"; actions: string[]; data: Array<{ source: string | null; json: string }> };

/** "get_weather" → "Get weather" */
export const humanizeName = (name: string): string => {
  const words = name.replace(/[_.-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const scalar = (v: unknown): string => (v !== null && typeof v === "object" ? JSON.stringify(v) : String(v));

/** "Looked up Get weather (location: Almeria, days: 1)" — never the call id. */
export function describeCall(call: ToolCall): string {
  const args = Object.entries(call.args).filter(([, v]) => v !== null && v !== undefined && v !== "");
  const detail = args.map(([k, v]) => `${k.replace(/_/g, " ")}: ${scalar(v)}`).join(", ");
  return tr("review-thread.used_name_detail", { name: humanizeName(call.name), detail: detail ? ` (${detail})` : "" });
}

export function conversationTurns(blocks: IoBlock[]): Turn[] {
  const turns: Turn[] = [];
  const pending: string[] = [];
  for (const block of blocks) {
    if (block.role === "system") continue;
    if (block.role === "tool") {
      turns.push({ kind: "data", source: pending.shift() ?? null, json: block.text });
      continue;
    }
    for (const call of block.calls ?? []) {
      pending.push(humanizeName(call.name));
      turns.push({ kind: "action", summary: describeCall(call) });
    }
    if (block.hideText || !block.text.trim()) continue;
    turns.push({ kind: block.role === "user" ? "user" : "message", text: block.text });
  }
  // the reply under review is what the assistant said after the user's last message, never a tool call, tool data or
  // an earlier turn of the history
  const lastUser = turns.map((t) => t.kind).lastIndexOf("user");
  for (let i = turns.length - 1; i > lastUser; i--) {
    const t = turns[i]!;
    if (t.kind === "message") {
      turns[i] = { kind: "answer", text: t.text };
      break;
    }
  }
  return turns;
}

/**
 * The thread as a reviewer needs it: what came before the user's last message is set aside (`earlier`), and the tool
 * calls and data after it become one folded `steps` row, so the question and the reply to review fill the screen.
 */
export function foldForReview(turns: Turn[]): { earlier: Turn[]; recent: Turn[] } {
  const from = Math.max(turns.map((t) => t.kind).lastIndexOf("user"), 0);
  const recent: Turn[] = [];
  for (const turn of turns.slice(from)) {
    if (turn.kind !== "action" && turn.kind !== "data") {
      recent.push(turn);
      continue;
    }
    const last = recent.at(-1);
    const steps = last?.kind === "steps" ? last : { kind: "steps" as const, actions: [], data: [] };
    if (turn.kind === "action") steps.actions.push(turn.summary);
    else steps.data.push({ source: turn.source, json: turn.json });
    if (steps !== last) recent.push(steps);
  }
  return { earlier: turns.slice(0, from), recent };
}
