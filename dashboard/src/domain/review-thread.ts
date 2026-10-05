import type { IoBlock, ToolCall } from "./span-io";

/** What a business reviewer sees: the conversation without ids, raw JSON or system prompts. */
export type Turn =
  | { kind: "user"; text: string }
  | { kind: "message"; text: string }
  | { kind: "answer"; text: string }
  | { kind: "action"; summary: string }
  | { kind: "data"; source: string | null; json: string };

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
  return `Used ${humanizeName(call.name)}${detail ? ` (${detail})` : ""}`;
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
