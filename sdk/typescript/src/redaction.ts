/**
 * Redaction policy for anything that leaves the process (ADR-021, ADR-095). Same two detectors as the Python SDK:
 * by key (a value under `api_key`, `password`... is masked) and by value (secrets with a recognizable shape).
 */
export const REDACTED = "****";
export const SERIALIZATION_FAILED = "[UNSERIALIZABLE]";

// Case-insensitive substrings of keys. "token" is deliberately absent: it would mask `input_tokens`.
export const DEFAULT_SENSITIVE_KEYS = [
  "api_key", "apikey", "api-key", "password", "passwd", "secret", "authorization", "access_token", "refresh_token",
  "private_key", "credential", "bearer", "cookie",
];

const MAX_DEPTH = 64;

export const CONTENT_KEYS = new Set([
  "gen_ai.input.messages", "gen_ai.output.messages", "gen_ai.system_instructions", "gen_ai.tool.call.arguments",
  "gen_ai.tool.call.result", "memtrace.input", "memtrace.output", "memtrace.metadata", "content", "exception.message",
  "exception.stacktrace",
]);
const CONTENT_PREFIXES = ["gen_ai.prompt", "gen_ai.completion", "pydantic_ai.", "traceloop.entity."];

const KEY_FRAGMENT = "(?:api[_-]?key|password|passwd|secret|authorization|access[_-]?token|refresh[_-]?token|private[_-]?key|credential|cookie)";

const TEXT_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, `Bearer ${REDACTED}`],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED], // JWT
  [/\bsk-[A-Za-z0-9_-]{16,}/g, REDACTED], // OpenAI / Anthropic
  [/\bmtk_[A-Za-z0-9]{10,}/g, REDACTED], // MemTrace API keys
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED], // AWS access key id
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/g, REDACTED], // GitHub
  [/\bAIza[0-9A-Za-z_-]{35}/g, REDACTED], // Google API key
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, REDACTED], // Slack
  [/(?<=:\/\/)[^/\s:@]+:[^/\s@]+(?=@)/g, REDACTED], // user:password@host
  // `password=hunter2`, `"api_key": "sk"`, `Authorization: xyz` in free text
  [new RegExp(`(\\b[\\w-]*${KEY_FRAGMENT}[\\w-]*["']?\\s*[:=]\\s*["']?)([^\\s"',;&}\\]]+)`, "gi"), `$1${REDACTED}`],
];

export function isSensitiveKey(key: unknown, sensitive: readonly string[]): boolean {
  const lowered = String(key).toLowerCase();
  return sensitive.some((fragment) => lowered.includes(fragment));
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  return /^[{[]/.test(trimmed) && /[}\]]$/.test(trimmed);
}

export type RedactHook = (value: unknown) => unknown;

/** Masks secrets in span attributes. `hook` (optional) receives content values and returns what to keep. */
export class Redactor {
  constructor(private readonly keys: readonly string[] = DEFAULT_SENSITIVE_KEYS, private readonly hook?: RedactHook) {}

  scrubText(text: string): string {
    return TEXT_PATTERNS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);
  }

  private redactData(value: unknown, depth = 0): unknown {
    if (typeof value === "string") return this.scrubText(value);
    if (depth >= MAX_DEPTH) return "…[max depth]";
    if (Array.isArray(value)) return value.map((v) => this.redactData(v, depth + 1));
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, isSensitiveKey(k, this.keys) ? REDACTED : this.redactData(v, depth + 1)]),
      );
    }
    return value;
  }

  private applyHook(value: unknown): unknown {
    if (!this.hook) return value;
    try {
      return this.hook(value);
    } catch {
      return SERIALIZATION_FAILED; // fail closed: a broken hook must never let raw content through
    }
  }

  private isContentKey(key: string): boolean {
    return CONTENT_KEYS.has(key) || CONTENT_PREFIXES.some((p) => key.startsWith(p));
  }

  stringAttribute(key: string, value: string): string {
    if (isSensitiveKey(key, this.keys)) return REDACTED;
    if (looksLikeJson(value)) {
      try {
        return JSON.stringify(this.applyHook(this.redactData(JSON.parse(value))));
      } catch {
        /* truncated / invalid JSON: treat as text below */
      }
    }
    const text = this.scrubText(value);
    if (this.hook && this.isContentKey(key)) {
      const hooked = this.applyHook(text);
      return typeof hooked === "string" ? hooked : JSON.stringify(hooked);
    }
    return text;
  }

  /** Redacted version of any attribute value; non-text values pass through untouched. */
  attribute(key: string, value: unknown): unknown {
    if (typeof value === "string") return this.stringAttribute(key, value);
    if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string")) {
      return value.map((v) => this.stringAttribute(key, v));
    }
    if (isSensitiveKey(key, this.keys) && value !== undefined && value !== null && typeof value !== "boolean") return REDACTED;
    return value;
  }
}
