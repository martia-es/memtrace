/** Resaltado de sintaxis mínimo y sin dependencias para el script, el `.env` y los comandos de instalación. Sin Vue ni HTTP. */

export type CodeLang = "python" | "env" | "shell";
export type TokenKind = "plain" | "keyword" | "builtin" | "string" | "comment" | "number" | "name" | "key";
export interface CodeToken {
  text: string;
  kind: TokenKind;
}

const PY_KEYWORDS = new Set(["import", "from", "def", "return", "for", "in", "if", "else", "elif", "raise", "with", "as", "class", "try", "except", "lambda", "None", "True", "False", "and", "or", "not"]);
const PY_BUILTINS = new Set(["print", "str", "int", "len", "reduce", "os", "httpx", "memtrace"]);

// una pasada por línea: comentario, cadena (con prefijo), número, palabra o cualquier otro carácter
const PY_PATTERN = /(#.*$)|((?:[rbf]|rb|br|fr|rf)?(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'))|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+|.)/gi;

function pythonLine(line: string, afterDef: { value: boolean }): CodeToken[] {
  const out: CodeToken[] = [];
  for (const m of line.matchAll(PY_PATTERN)) {
    const text = m[0];
    const [, comment, str, num, word] = m;
    if (comment) out.push({ text, kind: "comment" });
    else if (str) out.push({ text, kind: "string" });
    else if (num) out.push({ text, kind: "number" });
    else if (word) {
      if (afterDef.value) out.push({ text, kind: "name" });
      else if (PY_KEYWORDS.has(text)) out.push({ text, kind: "keyword" });
      else if (PY_BUILTINS.has(text)) out.push({ text, kind: "builtin" });
      else out.push({ text, kind: "plain" });
      afterDef.value = text === "def";
    } else out.push({ text, kind: "plain" });
  }
  return out;
}

function envLine(line: string): CodeToken[] {
  if (/^\s*#/.test(line)) return [{ text: line, kind: "comment" }];
  const m = /^(\s*[A-Za-z_][A-Za-z0-9_]*)(=)(.*)$/.exec(line);
  if (!m) return [{ text: line, kind: "plain" }];
  return [
    { text: m[1]!, kind: "key" },
    { text: m[2]!, kind: "plain" },
    { text: m[3]!, kind: m[3] ? "string" : "plain" },
  ];
}

function shellLine(line: string): CodeToken[] {
  if (/^\s*#/.test(line)) return [{ text: line, kind: "comment" }];
  const out: CodeToken[] = [];
  let first = true;
  for (const m of line.matchAll(/("(?:\\.|[^"\\])*"|'[^']*')|(&&|\|\||;)|(\s+)|([^\s"';&|]+)/g)) {
    const text = m[0];
    const str = m[1];
    const space = m[3];
    const word = m[4];
    if (str) out.push({ text, kind: "string" });
    else if (space) out.push({ text, kind: "plain" });
    else if (word) {
      out.push({ text, kind: first ? "builtin" : word.startsWith("-") ? "number" : "plain" });
      first = false;
    } else {
      out.push({ text, kind: "plain" });
      first = true;
    }
  }
  return out;
}

/** Una lista de tokens por línea. En Python, `"""…"""` (también multilínea) es una cadena. */
export function highlight(code: string, lang: CodeLang): CodeToken[][] {
  const lines = code.replace(/\n$/, "").split("\n");
  if (lang === "env") return lines.map(envLine);
  if (lang === "shell") return lines.map(shellLine);

  let inDoc = false;
  const afterDef = { value: false };
  return lines.map((line) => {
    if (inDoc) {
      const end = line.indexOf('"""');
      if (end === -1) return [{ text: line, kind: "string" as const }];
      inDoc = false;
      return [{ text: line.slice(0, end + 3), kind: "string" as const }, ...pythonLine(line.slice(end + 3), afterDef)];
    }
    const start = line.indexOf('"""');
    if (start === -1) return pythonLine(line, afterDef);
    const end = line.indexOf('"""', start + 3);
    if (end !== -1) return [...pythonLine(line.slice(0, start), afterDef), { text: line.slice(start, end + 3), kind: "string" as const }, ...pythonLine(line.slice(end + 3), afterDef)];
    inDoc = true;
    return [...pythonLine(line.slice(0, start), afterDef), { text: line.slice(start), kind: "string" as const }];
  });
}
