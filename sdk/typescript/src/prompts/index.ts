/**
 * Prompts of the MemTrace registry, versioned and tagged per environment (ADR-067, ADR-068).
 *
 *     import { prompts } from "@memtrace-ai/sdk";
 *     const weather = await prompts.get("weather-system");   // follows the tag named like MEMTRACE_ENVIRONMENT
 *     const system = weather.compile({ city });               // per request: in memory, no network
 *
 * Needs `MEMTRACE_API_URL` (with the experiment id) and `MEMTRACE_API_KEY`; the prompt must belong to that agent.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { settings } from "../config.js";
import { HttpClient } from "../http/client.js";
import { annotateCurrent, onShutdown } from "../tracer.js";
import type { LLMClient } from "../eval/types.js";
import { PROMPT_OVERRIDE_HEADER, isOverrideToken } from "./domain.js";
import { suggestFix, type FixCase } from "./fix.js";
import { FilePromptCache } from "./fileCache.js";
import { HttpPromptClient } from "./httpSource.js";
import { PromptRegistry, withPromptOverride, type PromptHandle } from "./registry.js";

export {
  MissingVariableError, PromptError, PromptNotFoundError, PromptUnavailableError, PROMPT_OVERRIDE_HEADER,
} from "./domain.js";
export { PromptHandle, PromptRegistry } from "./registry.js";
export { FixProposalError, suggestFix, type FixCase, type FixProposal } from "./fix.js";
export { HttpPromptClient } from "./httpSource.js";
export { FilePromptCache } from "./fileCache.js";

let registry: PromptRegistry | undefined;

/** The prompt registry of this process, built from the environment on first use. Without `MEMTRACE_API_URL` it serves each `default`. */
export function promptRegistry(): PromptRegistry {
  if (!registry) {
    const client = settings.apiUrl
      ? new HttpPromptClient({ baseUrl: settings.apiUrl, apiKey: settings.apiKey, timeoutMs: settings.promptTimeoutSeconds * 1000 })
      : undefined;
    const created = new PromptRegistry(client, {
      usage: client,
      cache: settings.promptCacheDir ? new FilePromptCache(settings.promptCacheDir) : undefined,
      annotate: annotateCurrent,
      environment: settings.environment,
      refreshSeconds: settings.promptRefreshSeconds,
      usageSeconds: settings.promptUsageSeconds,
      allowOverride: settings.allowPromptOverride,
    });
    registry = created;
    onShutdown(async () => { await created.shutdown(); if (registry === created) registry = undefined; });
  }
  return registry;
}

export interface GetOptions {
  tag?: string;
  version?: number;
  /** Text to use if MemTrace cannot be reached and there is no disk cache (`MEMTRACE_PROMPT_CACHE_DIR`). */
  default?: string;
}

/** The handle of prompt `name`, loaded now so a mistake fails at startup. A `version` is fixed; a `tag` is followed. */
export function get(name: string, options: GetOptions = {}): Promise<PromptHandle> {
  return promptRegistry().get(name, options);
}

/**
 * Runs `fn` as if MemTrace's playground had asked for it: `compile()` inside it uses the version `token` grants. Needs
 * `MEMTRACE_ALLOW_PROMPT_OVERRIDE=true`; otherwise (or with a token MemTrace does not recognize) it changes nothing.
 */
export async function override<T>(token: string | undefined | null, fn: () => T | Promise<T>): Promise<T> {
  if (settings.allowPromptOverride && isOverrideToken(token)) await promptRegistry().prefetchOverride(token);
  return withPromptOverride(settings.allowPromptOverride && isOverrideToken(token) ? token : undefined, fn);
}

/** Reads the playground header from a request's headers (Node `IncomingHttpHeaders` or a Fetch `Headers`). */
export function overrideTokenOf(headers: Headers | IncomingMessage["headers"]): string | undefined {
  const raw = headers instanceof Headers ? headers.get(PROMPT_OVERRIDE_HEADER) : headers[PROMPT_OVERRIDE_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return isOverrideToken(value) ? value : undefined;
}

/**
 * Express / Connect / Node `http` middleware that lets MemTrace's playground test a prompt version in this agent (ADR-071).
 * It does nothing unless `MEMTRACE_ALLOW_PROMPT_OVERRIDE=true`. Mount it after the body parser; with other frameworks
 * wrap the handling of the request in `prompts.override(prompts.overrideTokenOf(headers), ...)`.
 */
export function promptOverrideMiddleware() {
  return (req: IncomingMessage, _res: ServerResponse, next: (error?: unknown) => void): void => {
    const token = settings.allowPromptOverride ? overrideTokenOf(req.headers) : undefined;
    if (!token) return next();
    override(token, () => next()).catch((error) => next(error));
  };
}

/** Saves `content` as a **draft** of prompt `name` (ADR-072): a person reviews, tests and publishes it in MemTrace. */
export async function saveDraft(name: string, content: string, options: {
  rationale?: string; cause?: string; traceIds?: string[]; message?: string; basedOn?: number; baseUrl?: string; apiKey?: string; fetch?: typeof fetch;
} = {}): Promise<{ promptId: string; version: number }> {
  const { baseUrl, apiKey, fetch: fetchImpl, ...extra } = options;
  new HttpClient({ baseUrl, apiKey, fetch: fetchImpl }); // fails early with a clear message if the URL is missing
  return new HttpPromptClient({ baseUrl: baseUrl ?? settings.apiUrl, apiKey: apiKey ?? settings.apiKey, fetch: fetchImpl }).saveDraft(name, content, extra);
}

/**
 * Reads the current version of prompt `name`, asks **your** LLM (`llm`) how to fix `cases`, and saves the result as a draft.
 * Nothing is published: a person reviews, tests and publishes it. Throws `FixProposalError` if the proposal would break the
 * agent (it changes the `{{variables}}`, or changes nothing).
 */
export async function proposeFix(name: string, cases: FixCase[], llm: LLMClient, options: GetOptions & {
  instructions?: string; model?: string; baseUrl?: string; apiKey?: string; fetch?: typeof fetch;
} = {}): Promise<{ promptId: string; version: number }> {
  const { tag, version, instructions, model, ...http } = options;
  const handle = await get(name, { tag, version });
  const proposal = await suggestFix(handle.content, cases, llm, { instructions, model });
  return saveDraft(name, proposal.content, {
    ...http,
    rationale: proposal.rationale,
    cause: cases.find((c) => c.error)?.error,
    traceIds: cases.map((c) => c.traceId).filter((id): id is string => !!id),
    message: "Proposed fix",
    basedOn: handle.version > 0 ? handle.version : undefined,
  });
}
