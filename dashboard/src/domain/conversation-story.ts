import type { ConversationSummaryDto } from "@contract";
import { tr } from "./translate";

export type StoryTone = "neutral" | "error" | "warn";

export interface ConversationStory {
  text: string;
  tone: StoryTone;
}

const list = (names: string[]): string => names.join(", ");

/**
 * One plain sentence per conversation, composed from fixed rules over the list data (no model call). The first rule that
 * matches wins, from the most serious cause to the neutral description of what the agent did.
 */
export function conversationStory(c: ConversationSummaryDto): ConversationStory {
  const s = c.story;
  if (s.guardrailBlocks > 0) return { text: tr("conversationStory.blocked"), tone: "warn" };
  if (c.errorTurns > 0 && s.failedTools.length > 0) return { text: tr("conversationStory.tool_failed", { tools: list(s.failedTools) }), tone: "error" };
  if (c.errorTurns > 0) return { text: tr("conversationStory.failed"), tone: "error" };
  if (c.failedSpans > 0 && s.failedTools.length > 0) return { text: tr("conversationStory.recovered", { tools: list(s.failedTools) }), tone: "warn" };
  if (c.failedSpans > 0) return { text: tr("conversationStory.step_failed"), tone: "warn" };
  if (s.toolCalls > 0 && s.retrievals > 0) return { text: tr("conversationStory.tools_and_documents", { tools: list(s.tools) }), tone: "neutral" };
  if (s.toolCalls > 0) return { text: tr("conversationStory.used_tools", { tools: list(s.tools) }), tone: "neutral" };
  if (s.retrievals > 0) return { text: tr("conversationStory.used_documents"), tone: "neutral" };
  return { text: tr("conversationStory.direct"), tone: "neutral" };
}
