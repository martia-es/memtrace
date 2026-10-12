/**
 * Optional anonymization of personal data (PII) before spans leave the process (ADR-021, ADR-084, ADR-095). Plugs into
 * `initTracer({ redact })`, like `memtrace.pii` in the Python SDK.
 *
 *     import { initTracer, presidioRedactor } from "@memtrace-ai/sdk";
 *     initTracer({ redact: await presidioRedactor({ language: "es", url: "http://localhost:5002" }) });
 *
 * Presidio has no JavaScript engine, so `presidioRedactor` asks a Presidio **analyzer service** (the official
 * `mcr.microsoft.com/presidio-analyzer` image) which parts of a text are personal data, and masks them here with `****`.
 * The service runs the same recognizers and spaCy models as the Python SDK, so detection is the same. Run it where the agent
 * runs (a local container or a sidecar): the text of your spans is sent to it.
 *
 * Secrets (API keys, passwords...) are masked by the SDK itself, with or without this module.
 */
import { REDACTED, type RedactHook } from "./redaction.js";

// Precise entity types. Noisy ones (LOCATION, ORGANIZATION, DATE_TIME, NRP, URL, AGE, ID) are left out on purpose: they mask
// "San Francisco" or "tomorrow" and make traces useless. Ask for them explicitly with `entities` if you need them.
export const DEFAULT_ENTITIES = [
  "PERSON", "EMAIL_ADDRESS", "PHONE_NUMBER", "CREDIT_CARD", "IBAN_CODE", "IP_ADDRESS", "CRYPTO", "MEDICAL_LICENSE", "US_SSN",
  "US_PASSPORT", "US_ITIN", "US_DRIVER_LICENSE", "US_BANK_NUMBER", "UK_NHS", "ES_NIF", "ES_NIE",
];

const MAX_DEPTH = 64;
const MIN_TEXT_LENGTH = 3;
const CACHE_SIZE = 4096;

/**
 * Turns a `string -> string` function (sync or async) into a `redact` hook. `transform` is applied to every string value found
 * in the content of a span (dicts and lists of messages, tool arguments...); the structure is preserved and object keys are
 * left untouched.
 */
export function textHook(transform: (text: string) => string | Promise<string>): RedactHook {
  const walk = async (value: unknown, depth = 0): Promise<unknown> => {
    if (typeof value === "string") return transform(value);
    if (depth >= MAX_DEPTH) return value;
    if (Array.isArray(value)) return Promise.all(value.map((v) => walk(v, depth + 1)));
    if (value !== null && typeof value === "object") {
      const entries = await Promise.all(Object.entries(value).map(async ([k, v]) => [k, await walk(v, depth + 1)] as const));
      return Object.fromEntries(entries);
    }
    return value;
  };
  return (value) => walk(value);
}

export interface PresidioOptions {
  /** Base URL of the Presidio analyzer service. Default `PRESIDIO_ANALYZER_URL`, else `http://localhost:5002`. */
  url?: string;
  /** Language of the text (the service must have a model for it). Default `"en"`. */
  language?: string;
  /** Presidio entity types to mask; default `DEFAULT_ENTITIES` (those the service supports for the language). */
  entities?: string[];
  /** Minimum confidence (0-1) to mask a finding; raise it to mask less. Default 0.4. */
  scoreThreshold?: number;
  /** Exact strings that must never be masked (your company or product name). */
  allowList?: string[];
  timeoutMs?: number;
  fetch?: typeof fetch;
}

interface Finding { start: number; end: number }

/** Replaces the ranges with `****`, merging overlapping or touching findings into one mask. */
export function maskRanges(text: string, findings: Finding[]): string {
  const sorted = findings.filter((f) => f.end > f.start).sort((a, b) => a.start - b.start || b.end - a.end);
  let out = "", cursor = 0, current: Finding | undefined;
  const flush = () => { if (current) { out += text.slice(cursor, current.start) + REDACTED; cursor = current.end; } };
  for (const f of sorted) {
    if (current && f.start <= current.end) current = { start: current.start, end: Math.max(current.end, f.end) };
    else { flush(); current = { ...f }; }
  }
  flush();
  return out + text.slice(cursor);
}

/**
 * A `redact` hook that replaces personal data with `****` using a Presidio analyzer service. The mask is the same fixed `****` the
 * SDK uses for secrets, whatever the type or length of the data.
 *
 * It contacts the service now, so a wrong URL, a language without a model or no supported entity fails at startup. If the service
 * stops answering later, the content of the span is replaced by `[UNSERIALIZABLE]`: personal data is never exported unmasked.
 * Results are cached per text, so a conversation history resent on every turn is analyzed once.
 */
export async function presidioRedactor(options: PresidioOptions = {}): Promise<RedactHook> {
  const base = (options.url ?? process.env.PRESIDIO_ANALYZER_URL ?? "http://localhost:5002").replace(/\/+$/, "");
  const language = options.language ?? "en";
  const threshold = options.scoreThreshold ?? 0.4;
  const allowList = options.allowList ?? [];
  const doFetch = options.fetch ?? fetch;
  const timeout = options.timeoutMs ?? 5000;

  const call = async (path: string, init?: RequestInit): Promise<any> => {
    const response = await doFetch(base + path, { ...init, signal: AbortSignal.timeout(timeout) });
    if (!response.ok) throw new Error(`Presidio answered ${response.status}`);
    return response.json();
  };

  let supported: string[];
  try {
    supported = await call(`/supportedentities?language=${encodeURIComponent(language)}`);
  } catch (error) {
    throw new Error(`Could not reach the Presidio analyzer at ${base}: ${(error as Error).message}. Run: docker run -p 5002:3000 mcr.microsoft.com/presidio-analyzer`);
  }
  const wanted = options.entities ?? DEFAULT_ENTITIES;
  const selected = wanted.filter((entity) => supported.includes(entity));
  if (selected.length === 0) throw new Error(`None of the requested entities are supported for ${JSON.stringify(language)}: ${JSON.stringify([...supported].sort())}`);

  const cache = new Map<string, Promise<string>>();
  const anonymize = (text: string): Promise<string> => {
    if (text.length < MIN_TEXT_LENGTH || !/[\p{L}\p{N}]/u.test(text)) return Promise.resolve(text);
    const hit = cache.get(text);
    if (hit) return hit;
    const pending = call("/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language, entities: selected, score_threshold: threshold, allow_list: allowList }),
    }).then((findings: Array<{ start: number; end: number }>) => maskRanges(text, findings));
    if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as string);
    cache.set(text, pending);
    pending.catch(() => cache.delete(text)); // a failure is not remembered: the next span tries again
    return pending;
  };
  return textHook(anonymize);
}
