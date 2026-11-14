import { describe, expect, it } from "vitest";
import { conversationStory } from "@/domain/conversation-story";
import { conversation } from "../fakes";

const story = (over: Partial<ReturnType<typeof conversation>["story"]> = {}) => ({ toolCalls: 0, tools: [], failedTools: [], retrievals: 0, guardrailBlocks: 0, ...over });

describe("conversationStory", () => {
  it("names the tool that made the answer fail", () => {
    const s = conversationStory(conversation({ errorTurns: 1, failedSpans: 1, story: story({ toolCalls: 2, tools: ["get_coordinates"], failedTools: ["get_coordinates"] }) }));
    expect(s.tone).toBe("error");
    expect(s.text).toContain("get_coordinates");
  });

  it("a guardrail block wins over everything else", () => {
    expect(conversationStory(conversation({ errorTurns: 1, story: story({ guardrailBlocks: 1, failedTools: ["x"] }) })).tone).toBe("warn");
  });

  it("a failed step in an answered conversation is a warning", () => {
    expect(conversationStory(conversation({ failedSpans: 1, story: story({ failedTools: ["search"] }) })).tone).toBe("warn");
  });

  it("describes what the agent used when nothing failed", () => {
    expect(conversationStory(conversation({ story: story({ toolCalls: 1, tools: ["get_weather"] }) })).text).toContain("get_weather");
    expect(conversationStory(conversation({ story: story({ retrievals: 3 }) })).tone).toBe("neutral");
  });
});
