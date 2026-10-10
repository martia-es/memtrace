/** JSON serialization of captured payloads: bounded, redacted and never throwing (ADR-004, ADR-021). */
import { DEFAULT_SENSITIVE_KEYS, REDACTED, SERIALIZATION_FAILED, isSensitiveKey } from "./redaction.js";

const MAX_DEPTH = 8;
const MAX_ITEMS = 200;

export function truncate(text: string, limit: number): string {
  return limit > 0 && text.length > limit ? `${text.slice(0, limit)}…[truncated]` : text;
}

function prune(value: unknown, limit: number, sensitive: readonly string[], depth = 0): unknown {
  if (value === null || value === undefined || typeof value === "boolean") return value ?? null;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "string") return truncate(value, limit);
  if (depth >= MAX_DEPTH) return "…[max depth]";
  if (Array.isArray(value) || value instanceof Set) {
    const items = [...value];
    const pruned = items.slice(0, MAX_ITEMS).map((item) => prune(item, limit, sensitive, depth + 1));
    if (items.length > MAX_ITEMS) pruned.push(`…[${items.length - MAX_ITEMS} more items]`);
    return pruned;
  }
  if (typeof value === "object") {
    const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
    const pruned: Record<string, unknown> = {};
    for (const [index, [key, item]] of entries.entries()) {
      if (index >= MAX_ITEMS) {
        pruned["…"] = `[${entries.length - MAX_ITEMS} more items]`;
        break;
      }
      pruned[String(key)] = isSensitiveKey(key, sensitive) ? REDACTED : prune(item, limit, sensitive, depth + 1);
    }
    return pruned;
  }
  return truncate(String(value), limit);
}

/** JSON text of `value`, capped at `limit` characters (`0` = unlimited). Fails closed. */
export function toJson(value: unknown, limit = 0, sensitive: readonly string[] = DEFAULT_SENSITIVE_KEYS): string {
  try {
    return truncate(JSON.stringify(prune(value, limit, sensitive)), limit);
  } catch {
    return SERIALIZATION_FAILED;
  }
}

/** Content capture policy (ADR-004): opt-in and truncated. */
export class CapturePolicy {
  constructor(
    readonly enabled = false,
    readonly maxLength = 16384,
    readonly redactKeys: readonly string[] = DEFAULT_SENSITIVE_KEYS,
  ) {}

  apply(payload: unknown): string | undefined {
    if (!this.enabled || payload === undefined || payload === null) return undefined;
    return toJson(payload, this.maxLength, this.redactKeys);
  }
}
