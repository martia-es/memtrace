import { describe, expect, it } from "vitest";
import { fixtureDraftOf, parseFixtureText } from "@/domain/promote";
import { node } from "../fakes";

describe("fixtureDraftOf", () => {
  it("takes the input of the first span that has it and the output of the last to finish", () => {
    const roots = [
      node({
        spanId: "root",
        startTime: "2026-10-03T10:00:00.000Z",
        durationMs: 500,
        content: { input: { q: "capital of France?" } },
        children: [node({ spanId: "late", startTime: "2026-10-03T10:00:00.100Z", durationMs: 100, content: { input: "later", output: "Lyon" } })],
      }),
    ];
    expect(fixtureDraftOf(roots)).toEqual({ input: '{\n  "q": "capital of France?"\n}', observedOutput: "Lyon" });
  });

  it("falls back to chat messages and returns null observed output when absent", () => {
    const draft = fixtureDraftOf([node({ content: { inputMessages: [{ role: "user", content: "hi" }] } })]);
    expect(draft?.input).toContain('"role": "user"');
    expect(draft?.observedOutput).toBeNull();
  });

  it("returns null when no span captured input", () => {
    expect(fixtureDraftOf([node({ content: null }), node({ content: { output: "only output" } })])).toBeNull();
  });
});

describe("parseFixtureText", () => {
  it("parses JSON and keeps anything else as a string", () => {
    expect(parseFixtureText('{"a":1}')).toEqual({ a: 1 });
    expect(parseFixtureText("Paris")).toBe("Paris");
  });
});
