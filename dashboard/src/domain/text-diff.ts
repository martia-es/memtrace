import { diffLines } from "diff";

export type DiffCellKind = "same" | "del" | "add" | "empty";
export interface DiffCell {
  text: string;
  kind: DiffCellKind;
}
export interface DiffRow {
  left: DiffCell;
  right: DiffCell;
}

const EMPTY: DiffCell = { text: "", kind: "empty" };

function splitLines(value: string): string[] {
  const lines = value.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Diff de líneas en dos columnas estilo git: izquierda = antiguo (rojo lo quitado), derecha = nuevo
 * (verde lo añadido). Un bloque quitado seguido de uno añadido se empareja línea a línea, y el
 * lado más corto se rellena con celdas vacías para que ambas columnas queden alineadas. */
export function sideBySideDiff(oldText: string, newText: string): DiffRow[] {
  const rows: DiffRow[] = [];
  const parts = diffLines(oldText ? `${oldText}\n` : "", newText ? `${newText}\n` : "");
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!;
    if (!part.added && !part.removed) {
      for (const text of splitLines(part.value)) rows.push({ left: { text, kind: "same" }, right: { text, kind: "same" } });
      continue;
    }
    const next = parts[i + 1];
    const removed = part.removed ? splitLines(part.value) : [];
    const added = part.added ? splitLines(part.value) : next?.added ? splitLines(next.value) : [];
    if (part.removed && next?.added) i += 1;
    for (let n = 0; n < Math.max(removed.length, added.length); n += 1) {
      const del = removed[n];
      const add = added[n];
      rows.push({
        left: del === undefined ? EMPTY : { text: del, kind: "del" },
        right: add === undefined ? EMPTY : { text: add, kind: "add" },
      });
    }
  }
  return rows;
}

/** Texto estable de un item para compararlo: solo lo que cuenta como contenido (no la autoría). */
export function itemDiffText(item: { input: unknown; expectedOutput: unknown; metadata: Record<string, unknown> | null }): string {
  return JSON.stringify({ input: item.input, expectedOutput: item.expectedOutput, metadata: item.metadata }, null, 2);
}
