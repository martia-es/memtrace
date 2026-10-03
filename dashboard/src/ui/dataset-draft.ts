import type { CommitDatasetChangesBody, DatasetItemDto } from "@contract";

/**
 * Borrador de edición de los items de un dataset (ADR-041): todo lo que la persona teclea, pega,
 * duplica o borra vive aquí hasta que pulsa "Publish", y entonces se envía como UNA sola versión.
 * Lógica pura (sin Vue) para poder testearla.
 */

export interface DraftRow {
  /** Clave estable de la fila en la UI (no cambia al publicar ni al reordenar). */
  key: string;
  /** Id de fila en la última versión del servidor; null si la fila es nueva. */
  id: string | null;
  input: string;
  expected: string;
  /** JSON de metadata, o "" si no hay. */
  metadata: string;
  removed: boolean;
  /** Texto original del servidor (solo filas existentes), para detectar ediciones reales. */
  original: { input: string; expected: string; metadata: string } | null;
}

export type RowState = "empty" | "new" | "modified" | "removed" | "clean";

let keySeq = 0;
const nextKey = () => `row-${++keySeq}`;

/** Valor del servidor → texto de celda. Los strings tal cual; el resto como JSON compacto. */
export function toCellText(value: unknown): string {
  if (value == null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * Texto de celda → valor a guardar. Solo se interpreta como JSON si parece un objeto/array;
 * "4" o "true" se quedan como texto (una persona de negocio escribe texto, no tipos).
 */
export function parseCell(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      /* texto normal que empieza por { o [ */
    }
  }
  return text;
}

export function parseMetadata(text: string): Record<string, unknown> | null | "invalid" {
  if (!text.trim()) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : "invalid";
  } catch {
    return "invalid";
  }
}

export function rowFromItem(item: DatasetItemDto): DraftRow {
  const original = {
    input: toCellText(item.input),
    expected: toCellText(item.expectedOutput),
    metadata: item.metadata ? JSON.stringify(item.metadata) : "",
  };
  return { key: nextKey(), id: item.id, ...original, removed: false, original };
}

export function blankRow(seed: Partial<Pick<DraftRow, "input" | "expected" | "metadata">> = {}): DraftRow {
  return { key: nextKey(), id: null, input: "", expected: "", metadata: "", removed: false, original: null, ...seed };
}

export function rowsFromItems(items: DatasetItemDto[]): DraftRow[] {
  return [...items.map(rowFromItem), blankRow()];
}

export function rowState(row: DraftRow): RowState {
  if (row.id === null) return row.input.trim() || row.expected.trim() || row.metadata.trim() ? "new" : "empty";
  if (row.removed) return "removed";
  const o = row.original!;
  return row.input !== o.input || row.expected !== o.expected || row.metadata !== o.metadata ? "modified" : "clean";
}

/** Problema que impide publicar la fila, o null. */
export function rowProblem(row: DraftRow): string | null {
  const state = rowState(row);
  if (state === "empty" || state === "removed" || state === "clean") return null;
  if (!row.input.trim()) return "Input is required";
  if (row.metadata.trim() && parseMetadata(row.metadata) === "invalid") return "Metadata must be a JSON object";
  return null;
}

export interface DraftSummary {
  added: number;
  edited: number;
  removed: number;
  problems: number;
}

export function summarize(rows: DraftRow[]): DraftSummary {
  const s: DraftSummary = { added: 0, edited: 0, removed: 0, problems: 0 };
  for (const row of rows) {
    const state = rowState(row);
    if (state === "new") s.added++;
    else if (state === "modified") s.edited++;
    else if (state === "removed") s.removed++;
    if (rowProblem(row)) s.problems++;
  }
  return s;
}

export const isDirty = (rows: DraftRow[]) => {
  const s = summarize(rows);
  return s.added + s.edited + s.removed > 0;
};

/** Misma regla que el servidor (ADR-041): altas o bajas → MAJOR, solo ediciones → MINOR. */
export function nextVersionLabel(current: { major: number; minor: number }, s: DraftSummary): string {
  return s.added > 0 || s.removed > 0 ? `v${current.major + 1}.0` : `v${current.major}.${current.minor + 1}`;
}

/** Cuerpo de `POST .../changes`. Solo incluye los campos que cambiaron en cada edición. */
export function buildCommit(rows: DraftRow[]): CommitDatasetChangesBody {
  const body: Required<CommitDatasetChangesBody> = { add: [], update: [], remove: [] };
  for (const row of rows) {
    const state = rowState(row);
    const metadata = parseMetadata(row.metadata);
    if (state === "new") {
      body.add.push({ input: parseCell(row.input), expectedOutput: row.expected.trim() ? parseCell(row.expected) : null, metadata: metadata === "invalid" ? null : metadata });
    } else if (state === "removed") {
      body.remove.push(row.id!);
    } else if (state === "modified") {
      const o = row.original!;
      body.update.push({
        id: row.id!,
        ...(row.input !== o.input && { input: parseCell(row.input) }),
        ...(row.expected !== o.expected && { expectedOutput: row.expected.trim() ? parseCell(row.expected) : null }),
        ...(row.metadata !== o.metadata && { metadata: metadata === "invalid" ? null : metadata }),
      });
    }
  }
  return body;
}

/** Interpreta texto pegado desde Excel/Sheets/CSV-TSV: filas por salto de línea, columnas por tabulador (respeta celdas entrecomilladas con saltos). */
export function parseClipboardGrid(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === "\t") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * Pega una rejilla a partir de (rowIndex, col): rellena filas existentes (no borradas) y crea las
 * que falten. col 0 = input, 1 = expected. Devuelve las filas nuevas ya colocadas (siempre acaba en una fila en blanco).
 */
export function pasteGrid(rows: DraftRow[], rowIndex: number, col: 0 | 1, grid: string[][]): DraftRow[] {
  const out = rows.map((r) => ({ ...r }));
  grid.forEach((cells, dy) => {
    let target = out[rowIndex + dy];
    if (!target) {
      target = blankRow();
      out.push(target);
    }
    cells.forEach((value, dx) => {
      const c = col + dx;
      if (c === 0) target!.input = value;
      else if (c === 1) target!.expected = value;
    });
  });
  const last = out[out.length - 1];
  if (!last || rowState(last) !== "empty") out.push(blankRow());
  return out;
}
