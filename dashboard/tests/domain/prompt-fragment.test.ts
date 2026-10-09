import { describe, expect, it } from "vitest";
import { extractVariables, fragmentRefChoices, includeSyntax, insertSnippet } from "@/domain/prompt-fragment";

describe("prompt fragments helpers", () => {
  it("writes the include with a mandatory ref", () => {
    expect(includeSyntax("tone", "pro")).toBe("{{> tone@pro}}");
    expect(includeSyntax("tone", "3")).toBe("{{> tone@3}}");
  });

  it("extracts variables once, in order, ignoring includes", () => {
    expect(extractVariables("Hi {{name}}, {{ topic }} and {{name}}.\n{{> tone@pro}}")).toEqual(["name", "topic"]);
    expect(extractVariables("no variables")).toEqual([]);
  });

  it("offers the tags first (pro before pre before dev) and then a pin to the latest published version", () => {
    const choices = fragmentRefChoices({ dev: 6, pro: 5 }, 6);
    expect(choices.map((c) => c.label)).toEqual(["Follow tag pro", "Follow tag dev", "Pin to v6"]);
    expect(choices[0]).toMatchObject({ kind: "tag", ref: "pro", version: 5 });
    expect(choices[2]).toMatchObject({ kind: "version", ref: "6", version: 6 });
  });

  it("without tags only offers pinning, and nothing if nothing is published", () => {
    expect(fragmentRefChoices({}, 1).map((c) => c.ref)).toEqual(["1"]);
    expect(fragmentRefChoices({}, 0)).toEqual([]);
  });

  it("inserts at the caret or over a selection", () => {
    expect(insertSnippet("ab", 1, 1, "X")).toEqual({ text: "aXb", caret: 2 });
    expect(insertSnippet("abcd", 1, 3, "X")).toEqual({ text: "aXd", caret: 2 });
    expect(insertSnippet("ab", 99, 99, "X")).toEqual({ text: "abX", caret: 3 });
  });
});
