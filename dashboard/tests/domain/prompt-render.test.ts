import { describe, expect, it } from "vitest";
import { renderMarkdown, splitIncludes, versionForRef } from "@/domain/prompt-render";

describe("splitIncludes", () => {
  it("separates text from includes, in order", () => {
    expect(splitIncludes("Hola\n{{> tone@pro}}\nAdiós")).toEqual([
      { kind: "text", text: "Hola\n" },
      { kind: "include", name: "tone", ref: "pro", raw: "{{> tone@pro}}" },
      { kind: "text", text: "\nAdiós" },
    ]);
    expect(splitIncludes("sin includes")).toEqual([{ kind: "text", text: "sin includes" }]);
  });
});

describe("versionForRef", () => {
  it("resolves numbers directly and tags through the tag map", () => {
    expect(versionForRef("3", {})).toBe(3);
    expect(versionForRef("pro", { pro: 5 })).toBe(5);
    expect(versionForRef("pre", { pro: 5 })).toBeNull();
  });
});

describe("renderMarkdown", () => {
  it("renders headings, lists, emphasis and highlights variables", () => {
    const html = renderMarkdown("# Título\n\nHola **mundo** y *tú*, {{ciudad}}.\n\n- uno\n- dos\n\n1. a\n2. b");
    expect(html).toContain("<h1>Título</h1>");
    expect(html).toContain("<strong>mundo</strong>");
    expect(html).toContain("<em>tú</em>");
    expect(html).toContain('<span class="variable">{{ciudad}}</span>');
    expect(html).toContain("<ul><li>uno</li><li>dos</li></ul>");
    expect(html).toContain("<ol><li>a</li><li>b</li></ol>");
  });

  it("never lets HTML from the prompt through", () => {
    const html = renderMarkdown('<script>alert(1)</script> [x](javascript:alert(1)) [ok](https://a.b/c?d=1&e="2")');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("href=\"javascript");
    expect(html).toContain('<a href="https://a.b/c?d=1&amp;e=&quot;2&quot;"');
  });

  it("keeps code blocks and inline code literal", () => {
    const html = renderMarkdown("```\n**no** <b>\n```\n\nusa `{{x}}` ahora");
    expect(html).toContain("<pre><code>**no** &lt;b&gt;</code></pre>");
    expect(html).toContain("<code>{{x}}</code>");
  });
});
