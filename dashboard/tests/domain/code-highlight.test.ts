import { describe, expect, it } from "vitest";
import { highlight } from "@/domain/code-highlight";

const kinds = (line: ReturnType<typeof highlight>[number]) => line.filter((t) => t.kind !== "plain").map((t) => `${t.kind}:${t.text}`);

describe("code highlight", () => {
  it("colours python keywords, strings, comments and the function name", () => {
    const [def, call, comment] = highlight('def agent(*, item):\n    x = f("a", 1)\n# done', "python");
    expect(kinds(def!)).toEqual(["keyword:def", "name:agent"]);
    expect(kinds(call!)).toEqual(['string:"a"', "number:1"]);
    expect(kinds(comment!)).toEqual(["comment:# done"]);
  });

  it("treats a multi-line docstring as one string and keeps the code after it", () => {
    const lines = highlight('"""Title\nmore\n"""\nimport os', "python");
    expect(lines.slice(0, 3).every((l) => l.every((t) => t.kind === "string"))).toBe(true);
    expect(kinds(lines[3]!)).toEqual(["keyword:import", "builtin:os"]);
  });

  it("does not split a # inside a string", () => {
    expect(kinds(highlight('url = "http://x/#a"', "python")[0]!)).toEqual(['string:"http://x/#a"']);
  });

  it("colours .env keys, values and comments", () => {
    const [comment, pair, empty] = highlight('# MemTrace\nMEMTRACE_API_KEY="abc"\nEMPTY=', "env");
    expect(kinds(comment!)).toEqual(["comment:# MemTrace"]);
    expect(kinds(pair!)).toEqual(["key:MEMTRACE_API_KEY", 'string:"abc"']);
    expect(kinds(empty!)).toEqual(["key:EMPTY"]);
  });

  it("colours the command and the quoted package in a shell line", () => {
    expect(kinds(highlight('pip install "memtrace-ai[eval]" httpx', "shell")[0]!)).toEqual(["builtin:pip", 'string:"memtrace-ai[eval]"']);
  });

  it("never loses text: joining the tokens gives back the code", () => {
    const code = 'import os\n\ndef a():\n    return "x"  # c\n';
    const back = highlight(code, "python").map((l) => l.map((t) => t.text).join("")).join("\n");
    expect(back).toBe(code.replace(/\n$/, ""));
  });
});
