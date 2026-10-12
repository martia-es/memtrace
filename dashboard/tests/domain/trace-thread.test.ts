import { describe, expect, it } from "vitest";
import { traceThread } from "@/domain/trace-thread";
import { node } from "../fakes";

const user = { role: "user", parts: [{ type: "text", content: "Dame el tiempo en Granada" }] };
const call = { role: "assistant", parts: [{ type: "tool_call", name: "get_weather", id: "c1", arguments: { days: 7 } }] };
const result = { role: "user", parts: [{ type: "tool_call_response", id: "c1", result: { ok: true } }] };
const answer = { role: "assistant", parts: [{ type: "text", content: "Tormentas" }] };

describe("traceThread", () => {
  it("reads a Pydantic AI conversation once, not again from the model spans below it", () => {
    const agent = node({
      spanId: "a", attributes: { "pydantic_ai.all_messages": JSON.stringify([user, call, result, answer]) },
      children: [
        node({ spanId: "c1", kind: "llm", content: { inputMessages: [user], outputMessages: [call] } }),
        node({ spanId: "c2", kind: "llm", content: { inputMessages: [user, call, result], outputMessages: [answer] } }),
      ],
    });
    const blocks = traceThread([node({ spanId: "r", children: [agent] })]);
    expect(blocks.filter((b) => b.role === "user" && b.text.includes("Granada"))).toHaveLength(1);
    expect(blocks.filter((b) => b.text === "Tormentas")).toHaveLength(1);
  });

  it("still joins the spans' messages when none carries the whole conversation", () => {
    const root = node({ spanId: "r", children: [node({ spanId: "c1", kind: "llm", content: { inputMessages: [{ role: "user", content: "hola" }], outputMessages: [{ role: "assistant", content: "qué tal" }] } })] });
    expect(traceThread([root]).map((b) => b.text)).toEqual(["hola", "qué tal"]);
  });
});
