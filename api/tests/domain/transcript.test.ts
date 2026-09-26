import { describe, expect, it } from "vitest";
import { buildTranscript, type ChatSpanRecord } from "@/domain/transcript";

const rec = (traceId: string, t: number, input: unknown, output: unknown, model = "gpt-4o"): ChatSpanRecord => ({
  traceId, startTimeUs: t, model,
  inputMessages: input === null ? null : typeof input === "string" ? input : JSON.stringify(input),
  outputMessages: output === null ? null : typeof output === "string" ? output : JSON.stringify(output),
});

describe("buildTranscript", () => {
  it("takes the user message from the first LLM call and the answer from the last one", () => {
    const t = buildTranscript("c", [
      rec("t1", 1, [{ role: "system", content: "s" }, { role: "user", content: "¿Dónde está mi pedido?" }], [{ role: "assistant", content: "plan" }]),
      rec("t1", 2, [{ role: "user", content: "¿Dónde está mi pedido?" }, { role: "tool", content: "enviado" }], [{ role: "assistant", content: "Está en camino" }]),
    ], false);
    expect(t.turns).toEqual([{ traceId: "t1", startTimeUs: 1, model: "gpt-4o", user: "¿Dónde está mi pedido?", assistant: "Está en camino" }]);
    expect(t.contentCaptured).toBe(true);
  });

  it("uses only the latest user message when the history is resent", () => {
    const t = buildTranscript("c", [
      rec("t2", 5, [{ role: "user", content: "hola" }, { role: "assistant", content: "buenas" }, { role: "user", content: "¿y mi pedido?" }], [{ role: "assistant", content: "ok" }]),
    ], false);
    expect(t.turns[0]!.user).toBe("¿y mi pedido?");
  });

  it("orders turns chronologically and keeps a turn per trace", () => {
    const t = buildTranscript("c", [
      rec("late", 9, [{ role: "user", content: "b" }], [{ role: "assistant", content: "B" }]),
      rec("early", 1, [{ role: "user", content: "a" }], [{ role: "assistant", content: "A" }]),
    ], true);
    expect(t.turns.map((x) => x.traceId)).toEqual(["early", "late"]);
    expect(t.truncated).toBe(true);
  });

  it("understands LangChain roles (human/ai) and multimodal content parts", () => {
    const t = buildTranscript("c", [
      rec("t", 1, [{ role: "human", content: [{ type: "text", text: "mira esto" }, { type: "image_url", image_url: "x" }] }], [{ role: "ai", content: "visto" }]),
    ], false);
    expect(t.turns[0]).toMatchObject({ user: "mira esto", assistant: "visto" });
  });

  it("skips assistant outputs that only call tools (no text)", () => {
    const t = buildTranscript("c", [
      rec("t", 1, [{ role: "user", content: "q" }], [{ role: "assistant", content: "respuesta final" }]),
      rec("t", 2, [{ role: "user", content: "q" }], [{ role: "assistant", content: "" }]),
    ], false);
    expect(t.turns[0]!.assistant).toBe("respuesta final");
  });

  it("keeps truncated (invalid JSON) content as raw text instead of losing it", () => {
    const t = buildTranscript("c", [rec("t", 1, '[{"role":"user","content":"muy largo…[truncated]', [{ role: "assistant", content: "ok" }])], false);
    expect(t.turns[0]!.assistant).toBe("ok");
    expect(t.contentCaptured).toBe(true);
  });

  it("reports that content was not captured, with no turns", () => {
    const t = buildTranscript("c", [rec("t", 1, null, null)], false);
    expect(t).toMatchObject({ contentCaptured: false, turns: [] });
  });

  it("skips turns without any message", () => {
    expect(buildTranscript("c", [rec("t", 1, [{ role: "system", content: "s" }], [])], false).turns).toEqual([]);
  });
});
