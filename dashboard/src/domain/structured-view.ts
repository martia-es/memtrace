/**
 * A JSON object read as rows instead of braces: scalars as `key | value`, nested objects flattened one level with
 * dotted keys (`current.temperature_c`) and lists of objects as a small table. The raw JSON stays one click away.
 */
export type StructuredRow =
  | { kind: "field"; key: string; value: string }
  | { kind: "table"; key: string; columns: string[]; rows: string[][]; total: number };

const MAX_VALUE = 200;
const MAX_COLUMNS = 6;
const MAX_TABLE_ROWS = 50;

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const compact = (v: unknown): string => {
  const text = v === null || v === undefined ? "–" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE - 1)}…` : text;
};

function collect(value: Record<string, unknown>, prefix: string, depth: number, out: StructuredRow[]): void {
  for (const [k, v] of Object.entries(value)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isObject(v) && depth < 1 && Object.keys(v).length > 0) {
      collect(v, key, depth + 1, out);
    } else if (Array.isArray(v) && v.length > 0 && v.every(isObject)) {
      const objects = v as Record<string, unknown>[];
      const columns = Object.keys(objects[0]!).slice(0, MAX_COLUMNS);
      out.push({ kind: "table", key, columns, rows: objects.slice(0, MAX_TABLE_ROWS).map((o) => columns.map((c) => compact(o[c]))), total: objects.length });
    } else if (Array.isArray(v) && v.every((x) => x === null || typeof x !== "object")) {
      out.push({ kind: "field", key, value: v.map(compact).join(", ") || "–" });
    } else {
      out.push({ kind: "field", key, value: compact(v) });
    }
  }
}

/** The rows for a JSON text, or null when it is not an object (plain text, a list, a number…). */
export function structuredRows(json: string): StructuredRow[] | null {
  const text = json.trim();
  if (!text.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isObject(parsed) || Object.keys(parsed).length === 0) return null;
    const rows: StructuredRow[] = [];
    collect(parsed, "", 0, rows);
    return rows;
  } catch {
    return null;
  }
}
