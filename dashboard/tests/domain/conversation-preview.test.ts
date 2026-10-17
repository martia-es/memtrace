import { describe, expect, it } from "vitest";
import { conversationPreview } from "@/domain/conversation-preview";

const chat = JSON.stringify([
  { role: "system", content: "Eres un asistente del tiempo." },
  { role: "user", content: "¿Qué temperatura hará\nen Bilbao?" },
]);

describe("conversationPreview", () => {
  it("shows the last user message of an input on one line", () => {
    const p = conversationPreview(chat, "input")!;
    expect(p.count).toBe(2);
    expect(p.summary).toBe("¿Qué temperatura hará en Bilbao?");
    expect(p.blocks.map((b) => b.role)).toEqual(["system", "user"]);
  });

  it("shows the last assistant message of an expected output", () => {
    const text = JSON.stringify([{ role: "assistant", content: "Nublado, 18 grados" }]);
    expect(conversationPreview(text, "expected")!.summary).toBe("Nublado, 18 grados");
  });

  it("falls back to the last message with text when the wanted role is missing", () => {
    expect(conversationPreview(chat, "expected")!.summary).toBe("¿Qué temperatura hará en Bilbao?");
  });

  it("reads messages made of typed parts (OpenTelemetry / Pydantic AI)", () => {
    const text = JSON.stringify([{ role: "user", parts: [{ type: "text", content: "hola" }] }]);
    expect(conversationPreview(text, "input")!.summary).toBe("hola");
  });

  it.each([["plain text"], ['{"city":"Madrid"}'], ["[1,2,3]"], ['[{"q":"x"}]'], ["[]"], ["[not json"], [""]])("leaves %j as an editable cell", (text) => {
    expect(conversationPreview(text, "input")).toBeNull();
  });
});
