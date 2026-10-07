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

describe("trace revision (ADR-065)", () => {
  it("comes from the root span and falls back to any span", () => {
    const root = span({ spanId: "r", revision: "a".repeat(40) });
    const child = span({ parentSpanId: "r", revision: "b".repeat(40) });
    expect(buildTraceDetail("t", [child, root], false).revision).toBe("a".repeat(40));
    expect(buildTraceDetail("t", [span({ spanId: "r" }), span({ parentSpanId: "r", revision: "c".repeat(40) })], false).revision).toBe("c".repeat(40));
  });

  it("is null when no span carries it", () => {
    expect(buildTraceDetail("t", [span({ spanId: "r", revision: null })], false).revision).toBeNull();
  });
});
