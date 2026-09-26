import { describe, expect, it } from "vitest";
import { buildTraceDetail } from "@/domain/tree";
import { span } from "../helpers";

describe("trace conversation id", () => {
  it("comes from the root span", () => {
    const root = span({ spanId: "r", attributes: { "gen_ai.conversation.id": "c1" } });
    const child = span({ parentSpanId: "r", attributes: { "gen_ai.conversation.id": "other" } });
    expect(buildTraceDetail("t", [root, child], false).conversationId).toBe("c1");
  });

  it("falls back to any span that carries it, or null", () => {
    const root = span({ spanId: "r" });
    const child = span({ parentSpanId: "r", attributes: { "gen_ai.conversation.id": "c2" } });
    expect(buildTraceDetail("t", [root, child], false).conversationId).toBe("c2");
    expect(buildTraceDetail("t", [span()], false).conversationId).toBeNull();
  });
});
