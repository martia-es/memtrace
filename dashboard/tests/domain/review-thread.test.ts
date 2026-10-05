import { describe, expect, it } from "vitest";
import { conversationTurns, humanizeName } from "@/domain/review-thread";
import { langchainAdapter } from "@/domain/span-io";

describe("conversationTurns", () => {
  const messages = [
    { role: "system", content: "You are a weather bot" },
    { role: "user", content: "Que tiempo va a hacer hoy en Almeria?" },
    { role: "assistant", content: [{ type: "tool_call", id: "call_ai_1", name: "get_weather", arguments: { days: 1, location: "Almeria" } }] },
    { role: "user", content: [{ type: "tool_call_response", id: "call_ai_1", result: { temperature_c: 23.7 } }] },
  ];

  it("turns tool calls into a sentence without ids or JSON, and tool data into a collapsed block", () => {
    const turns = conversationTurns(langchainAdapter.parse(messages));
    expect(turns.map((t) => t.kind)).toEqual(["user", "action", "data"]);
    expect(turns[1]).toEqual({ kind: "action", summary: "Used Get weather (days: 1, location: Almeria)" });
    expect(turns[2]).toMatchObject({ kind: "data", source: "Get weather" });
  });

  it("marks the last assistant text as the reply to review, and none when the trace lacks it", () => {
    expect(conversationTurns(langchainAdapter.parse(messages)).some((t) => t.kind === "answer")).toBe(false);
    const withReply = [...messages, { role: "assistant", content: "Hoy habrá tormenta." }];
    const turns = conversationTurns(langchainAdapter.parse(withReply));
    expect(turns.at(-1)).toEqual({ kind: "answer", text: "Hoy habrá tormenta." });
  });

  it("does not take an earlier assistant turn of the history as the reply to review", () => {
    const history = [
      { role: "user", content: "Hola" },
      { role: "assistant", content: "¡Hola! ¿En qué puedo ayudarte?" },
      { role: "user", content: "¿qué tiempo hace?" },
    ];
    const turns = conversationTurns(langchainAdapter.parse(history));
    expect(turns.map((t) => t.kind)).toEqual(["user", "message", "user"]);
  });

  it("humanizes function names", () => {
    expect(humanizeName("get_weather")).toBe("Get weather");
    expect(humanizeName("searchOrders")).toBe("Search orders");
  });
});
