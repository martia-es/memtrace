/** Utilidades de la UI de fragmentos (ADR-073): sintaxis de inclusión, variables que aporta un texto y cómo insertarlo. */

/** `{{> nombre@ref}}`: `ref` es un tag (`pro`) o un número de versión (`3`), siempre obligatorio. */
export function includeSyntax(name: string, ref: string): string {
  return `{{> ${name}@${ref}}}`;
}

/** Nombres de las `{{variables}}` de un texto, sin repetir y en orden de aparición; las inclusiones `{{> x@y}}` no cuentan. */
export function extractVariables(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)) seen.add(match[1]!);
  return [...seen];
}

export interface FragmentRefChoice {
  kind: "tag" | "version";
  /** lo que va detrás de la `@` */
  ref: string;
  /** versión a la que resuelve hoy */
  version: number;
  label: string;
}

/**
 * Formas de referirse a un fragmento: seguir un tag (cambia cuando el tag se mueve, y el prompt recibe un borrador) o fijar un
 * número. Sin tags, solo el número de la última versión publicada.
 */
export function fragmentRefChoices(tags: Record<string, number>, latestPublished: number): FragmentRefChoice[] {
  const order = ["pro", "pre", "dev"];
  const names = Object.keys(tags).sort((a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)) || a.localeCompare(b));
  const byTag = names.map((tag): FragmentRefChoice => ({ kind: "tag", ref: tag, version: tags[tag]!, label: `Follow tag ${tag}` }));
  const pinned: FragmentRefChoice[] = latestPublished > 0 ? [{ kind: "version", ref: String(latestPublished), version: latestPublished, label: `Pin to v${latestPublished}` }] : [];
  return [...byTag, ...pinned];
}

/** Inserta `snippet` en `text` sustituyendo la selección `[start, end)`; devuelve el texto nuevo y dónde queda el cursor. */
export function insertSnippet(text: string, start: number, end: number, snippet: string): { text: string; caret: number } {
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  return { text: text.slice(0, from) + snippet + text.slice(to), caret: from + snippet.length };
}
