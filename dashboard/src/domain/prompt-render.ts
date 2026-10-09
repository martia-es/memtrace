/**
 * Vista renderizada de un prompt: markdown básico con los fragmentos incrustados (ADR-073).
 * No usa HTML del usuario: todo se escapa antes de aplicar formato, así el resultado es seguro para `v-html`.
 */

export type PromptSegment = { kind: "text"; text: string } | { kind: "include"; name: string; ref: string; raw: string };

const INCLUDE = /\{\{>\s*([^@\s}]+)@([^\s}]+)\s*\}\}/g;

/** Parte el texto en trozos de texto e inclusiones `{{> nombre@ref}}`, en orden. */
export function splitIncludes(text: string): PromptSegment[] {
  const segments: PromptSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(INCLUDE)) {
    const at = match.index!;
    if (at > last) segments.push({ kind: "text", text: text.slice(last, at) });
    segments.push({ kind: "include", name: match[1]!, ref: match[2]!, raw: match[0] });
    last = at + match[0].length;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
}

/** Versión a la que apunta `ref` (número de versión o tag); null si no existe. */
export function versionForRef(ref: string, tags: Record<string, number>): number | null {
  if (/^\d+$/.test(ref)) return Number(ref);
  return tags[ref] ?? null;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(raw: string): string {
  const codes: string[] = [];
  let s = escapeHtml(raw).replace(/`([^`]+)`/g, (_, code: string) => `\u0000${codes.push(code) - 1}\u0000`);
  s = s.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, '<span class="variable">{{$1}}</span>');
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code>${codes[Number(i)]}</code>`);
}

/** Markdown básico (títulos, listas, citas, código, negrita, cursiva, enlaces) a HTML escapado. */
export function renderMarkdown(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  const flush = () => {
    if (paragraph.length > 0) out.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
    if (list) out.push(`<${list.tag}>${list.items.map((item) => `<li>${inline(item)}</li>`).join("")}</${list.tag}>`);
    paragraph = [];
    list = null;
  };
  const addItem = (tag: "ul" | "ol", item: string) => {
    if (paragraph.length > 0 || (list && list.tag !== tag)) flush();
    if (!list) list = { tag, items: [] };
    list.items.push(item);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let m: RegExpMatchArray | null;
    if (line.startsWith("```")) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.startsWith("```"); i++) code.push(lines[i]!);
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    } else if (line.trim() === "") {
      flush();
    } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flush();
      out.push(`<h${m[1]!.length}>${inline(m[2]!)}</h${m[1]!.length}>`);
    } else if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      flush();
      out.push("<hr>");
    } else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      addItem("ul", m[1]!);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      addItem("ol", m[1]!);
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flush();
      out.push(`<blockquote>${inline(m[1]!)}</blockquote>`);
    } else {
      if (list) flush();
      paragraph.push(line);
    }
  }
  flush();
  return out.join("");
}
