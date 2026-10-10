/** Prompt registry concepts (ADR-067, ADR-068, ADR-095). Pure: no HTTP, no timers, no OpenTelemetry. */

// `{{name}}` or `{{ name }}`; the same rule the API uses to detect variables when a version is saved.
const VARIABLE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const TOKEN = /^mto_[A-Za-z0-9_-]{10,200}$/;

/** Span attributes that link a trace to the prompt version it used. */
export const PROMPT_NAME_ATTRIBUTE = "memtrace.prompt.name";
export const PROMPT_VERSION_ATTRIBUTE = "memtrace.prompt.version";
/** Written on the span when the prompt came from a playground override instead of the tag (ADR-071). */
export const PLAYGROUND_ATTRIBUTE = "memtrace.playground";
/** Header with which MemTrace hands the agent the token of a playground override. */
export const PROMPT_OVERRIDE_HEADER = "x-memtrace-prompt-override";

export function isOverrideToken(value: string | undefined | null): value is string {
  return !!value && TOKEN.test(value);
}

export class PromptError extends Error {
  constructor(message: string) { super(message); this.name = new.target.name; }
}
/** The prompt, tag or version does not exist for this agent: a configuration mistake, never hidden. */
export class PromptNotFoundError extends PromptError {}
/** MemTrace could not be reached and there is nothing to fall back to (no cache, no `default`). */
export class PromptUnavailableError extends PromptError {}
/** `compile()` was called without some variable the prompt uses. */
export class MissingVariableError extends PromptError {
  constructor(readonly prompt: string, readonly missing: string[]) {
    super(`Prompt '${prompt}' needs the variable(s): ${missing.join(", ")}`);
  }
}
/** The registry could not be reached or answered with a server error. Transient: the last known version keeps serving. */
export class PromptSourceError extends PromptError {}

/** One immutable version. `version === 0` means *not from the registry*: the local `default` (never stamped or reported). */
export interface PromptVersion {
  name: string;
  version: number;
  content: string;
  variables: string[];
  contentHash: string;
  archived: boolean;
  /** A proposal waiting for review (ADR-072): it can be evaluated by number but must not run in production. */
  draft: boolean;
}

export const fromRegistry = (version: PromptVersion): boolean => version.version > 0;

export function extractVariables(content: string): string[] {
  return [...new Set([...content.matchAll(VARIABLE)].map((m) => m[1] as string))];
}

export function localDefault(name: string, content: string): PromptVersion {
  return { name, version: 0, content, variables: extractVariables(content), contentHash: "", archived: false, draft: false };
}

/** Substitutes `{{name}}` with `String(values[name])`. Extra values are ignored; a missing one is an error. */
export function render(version: PromptVersion, values: Record<string, unknown>): string {
  const missing = version.variables.filter((name) => !(name in values));
  if (missing.length > 0) throw new MissingVariableError(version.name, missing);
  // nothing is evaluated: a value containing `{{other}}` is not expanded again
  return version.content.replace(VARIABLE, (_match, name: string) => String(values[name]));
}

/** The tag followed when the agent names none: the one called like its environment (`dev`, `pre`, `pro`). */
export function defaultTag(environment: string | undefined): string {
  const tag = (environment ?? "").trim().toLowerCase();
  if (!tag) throw new Error("Pass tag or version, or set MEMTRACE_ENVIRONMENT so the prompt follows the tag of that environment");
  return tag;
}

export interface Fetched { version: PromptVersion; etag: string | null }
export interface UsedPrompt { name: string; tag: string | null; version: number }

/** `fetch` resolves to `null` when the version the caller already holds is still the right one (304). */
export interface PromptSource {
  fetch(name: string, tag: string | undefined, version: number | undefined, etag: string | null): Promise<Fetched | null>;
  fetchOverride(name: string, token: string): Promise<PromptVersion | null>;
}
export interface UsageSink {
  report(environment: string | undefined, items: UsedPrompt[]): Promise<void>;
}
export interface PromptCache {
  load(name: string, tag: string | undefined, version: number | undefined): PromptVersion | undefined;
  store(name: string, tag: string | undefined, version: number | undefined, value: PromptVersion): void;
}
