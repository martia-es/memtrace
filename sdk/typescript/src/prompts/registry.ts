/**
 * Prompts of the registry, ready to use from an agent (ADR-068, ADR-095).
 *
 * `get()` returns a `PromptHandle`, not text: the version has to be decided *when the prompt is used*, so the handle keeps
 * the version it follows and the agent calls `handle.compile(...)` on every request. `compile()` never touches the network,
 * a timer follows the tag (`If-None-Match`: an unchanged tag costs an empty 304), the last known version keeps serving if
 * MemTrace is down, and the same timer tells MemTrace which versions this agent is using.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import {
  PLAYGROUND_ATTRIBUTE, PROMPT_NAME_ATTRIBUTE, PROMPT_VERSION_ATTRIBUTE, PromptNotFoundError, PromptSourceError,
  PromptUnavailableError, defaultTag, fromRegistry, isOverrideToken, localDefault, render,
  type Fetched, type PromptCache, type PromptSource, type PromptVersion, type UsageSink, type UsedPrompt,
} from "./domain.js";

const MAX_BACKOFF_SECONDS = 300;
const USAGE_RETRY_SECONDS = 60;
const TICK_SECONDS = 1;
const OVERRIDE_CACHE_SECONDS = 300;
const OVERRIDE_CACHE_SIZE = 64;

const overrides = new AsyncLocalStorage<{ token?: string }>();

/** Runs `fn` as if MemTrace's playground had asked for it: `compile()` inside it uses the version `token` grants (ADR-071). */
export function withPromptOverride<T>(token: string | undefined | null, fn: () => T): T {
  return overrides.run({ token: token ?? undefined }, fn);
}

type Key = [name: string, tag: string | undefined, version: number | undefined];
const keyString = (key: Key) => JSON.stringify(key);

export class PromptHandle {
  /** @internal */ failures = 0;
  /** @internal */ warned = false;

  /** @internal */
  constructor(
    private readonly registry: PromptRegistry,
    /** @internal */ readonly key: Key,
    /** @internal */ public current: PromptVersion,
    /** @internal */ public etag: string | null,
    /** @internal */ public nextCheck: number,
  ) {}

  get name(): string { return this.key[0]; }
  /** The tag this handle follows; `undefined` when it is pinned to a version. */
  get tag(): string | undefined { return this.key[1]; }
  /** Number of the version in use now (0 = the local `default`, MemTrace was not reachable). */
  get version(): number { return this.current.version; }
  /** The raw text in use now, with its `{{variables}}`. */
  get content(): string { return this.current.content; }
  get variables(): string[] { return this.current.variables; }

  /**
   * The text of the version in use, with `{{name}}` replaced by `String(values[name])`. Throws `MissingVariableError` if a
   * variable is not given. Also stamps the prompt name and version on the current step, which links a trace to its version.
   */
  compile(values: Record<string, unknown> = {}): string {
    const [current, playground] = this.registry.effective(this); // one read: a refresh in the middle cannot mix two versions
    const text = render(current, values);
    this.registry.noteUse(current, playground);
    return text;
  }

  /** A function that returns `compile(values)` each time it is called, for frameworks that take the prompt as a function. */
  asCallable(values: Record<string, unknown> = {}): () => string {
    return () => this.compile(values);
  }

  toString(): string {
    return `<PromptHandle ${this.name} ${this.tag ? `tag=${this.tag}` : `version=${this.key[2]}`} -> v${this.version}>`;
  }
}

export interface RegistryOptions {
  usage?: UsageSink;
  cache?: PromptCache;
  annotate?: (attributes: Record<string, unknown>) => void;
  environment?: string;
  refreshSeconds?: number;
  usageSeconds?: number;
  allowOverride?: boolean;
  /** Seconds, monotonic. Injected by tests. */
  clock?: () => number;
  log?: (level: "debug" | "info" | "warn", message: string) => void;
}

export class PromptRegistry {
  private readonly environment: string | undefined;
  private readonly refreshSeconds: number;
  private readonly usageSeconds: number;
  private readonly clock: () => number;
  private readonly log: NonNullable<RegistryOptions["log"]>;
  private readonly handles = new Map<string, PromptHandle>();
  private readonly overrideCache = new Map<string, [expires: number, version: PromptVersion | null]>();
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private nextUsage = 0;

  constructor(private readonly source: (PromptSource & Partial<UsageSink>) | undefined, private readonly options: RegistryOptions = {}) {
    this.environment = (options.environment ?? "").trim().toLowerCase() || undefined;
    this.refreshSeconds = Math.max(1, options.refreshSeconds ?? 30);
    this.usageSeconds = Math.max(1, options.usageSeconds ?? 300);
    this.clock = options.clock ?? (() => performance.now() / 1000);
    this.log = options.log ?? ((level, message) => { if (level === "warn") console.warn(`[MemTrace] ${message}`); });
  }

  /**
   * The handle of a prompt, asking MemTrace once (a few seconds at most) so a wrong name fails at startup. `tag` or `version`,
   * not both; with neither, it follows the tag named like `MEMTRACE_ENVIRONMENT`. `default` is the text to use if MemTrace
   * cannot be reached and there is no disk cache. Asking again for the same prompt returns the same handle.
   */
  async get(name: string, options: { tag?: string; version?: number; default?: string } = {}): Promise<PromptHandle> {
    let { tag, version } = options;
    if (tag !== undefined && version !== undefined) throw new Error("Pass tag or version, not both");
    if (version !== undefined && version < 1) throw new Error("version must be 1 or greater");
    if (tag === undefined && version === undefined) tag = defaultTag(this.environment);
    const key: Key = [name, tag, version];
    const existing = this.handles.get(keyString(key));
    if (existing) return existing;
    const handle = await this.open(key, options.default);
    const raced = this.handles.get(keyString(key)); // another caller opened it while we waited
    if (raced) return raced;
    this.handles.set(keyString(key), handle);
    this.ensureTimer();
    return handle;
  }

  async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One pass of the background work: follow the tags that are due and report usage. The timer calls it every second. */
  async runOnce(): Promise<void> {
    const now = this.clock();
    const handles = [...this.handles.values()];
    for (const handle of handles) {
      if (!this.isFinal(handle) && now >= handle.nextCheck) await this.refresh(handle);
    }
    if (this.options.usage && now >= this.nextUsage) await this.reportUsage(handles);
  }

  // ----- opening -----

  private async open(key: Key, fallbackText: string | undefined): Promise<PromptHandle> {
    const [name, tag, version] = key;
    const now = this.clock();
    if (!this.source) {
      return new PromptHandle(this, key, this.fallback(key, fallbackText, "MEMTRACE_API_URL is not set"), null, now + this.refreshSeconds);
    }
    try {
      const fetched = await this.source.fetch(name, tag, version, null);
      if (!fetched) throw new PromptSourceError("empty answer"); // without an etag the registry always answers with the version
      this.options.cache?.store(name, tag, version, fetched.version);
      if (fetched.version.draft) this.log("warn", `Prompt '${name}' v${fetched.version.version} is a DRAFT (not reviewed yet). Use it to evaluate, not in production.`);
      return new PromptHandle(this, key, fetched.version, fetched.etag, now + this.refreshSeconds);
    } catch (error) {
      if (error instanceof PromptNotFoundError) throw error;
      if (!(error instanceof PromptSourceError)) throw error;
      // retry soon: the agent should leave the fallback as soon as MemTrace answers
      return new PromptHandle(this, key, this.fallback(key, fallbackText, error.message), null, now + Math.min(this.refreshSeconds, 5));
    }
  }

  private fallback(key: Key, text: string | undefined, reason: string): PromptVersion {
    const [name, tag, version] = key;
    const cached = this.options.cache?.load(name, tag, version);
    if (cached) {
      this.log("warn", `Prompt '${name}' served from the disk cache (v${cached.version}): ${reason}`);
      return cached;
    }
    if (text !== undefined) {
      this.log("warn", `Prompt '${name}' using the local default: ${reason}`);
      return localDefault(name, text);
    }
    throw new PromptUnavailableError(`Could not load prompt '${name}' from MemTrace and no default or cache is set: ${reason}`);
  }

  // ----- following the tag -----

  /** A pinned version never changes: once we hold the real one there is nothing to follow. */
  private isFinal(handle: PromptHandle): boolean {
    return handle.key[2] !== undefined && fromRegistry(handle.current);
  }

  private async refresh(handle: PromptHandle): Promise<void> {
    if (!this.source) return;
    const [name, tag, version] = handle.key;
    let fetched: Fetched | null;
    try {
      fetched = await this.source.fetch(name, tag, version, handle.etag);
    } catch (error) {
      if (!(error instanceof PromptNotFoundError || error instanceof PromptSourceError)) throw error;
      this.failed(handle, `${error.message} (keeping v${handle.current.version})`);
      return;
    }
    handle.failures = 0;
    handle.warned = false;
    handle.nextCheck = this.clock() + this.refreshSeconds;
    if (!fetched) return;
    const previous = handle.current.version;
    handle.current = fetched.version;
    handle.etag = fetched.etag;
    this.options.cache?.store(name, tag, version, fetched.version);
    if (previous !== fetched.version.version) {
      this.log("info", `Prompt '${name}' ${tag ? `tag '${tag}'` : ""} moved from v${previous} to v${fetched.version.version}`);
      this.nextUsage = 0; // tell MemTrace soon
    }
  }

  private failed(handle: PromptHandle, message: string): void {
    handle.failures += 1;
    handle.nextCheck = this.clock() + Math.min(this.refreshSeconds * 2 ** handle.failures, MAX_BACKOFF_SECONDS);
    if (!handle.warned) { // once per streak: a long outage must not flood the log
      this.log("warn", `Could not refresh prompt '${handle.name}': ${message}`);
      handle.warned = true;
    }
  }

  // ----- using it -----

  /** @internal The version to use in this request and whether it comes from a playground override (ADR-071). */
  effective(handle: PromptHandle): [PromptVersion, boolean] {
    const token = this.options.allowOverride && this.source ? overrides.getStore()?.token : undefined;
    if (!token) return [handle.current, false];
    const granted = this.overrideFor(handle.name, token);
    return granted ? [granted, true] : [handle.current, false];
  }

  // `compile()` is synchronous, so the playground's version is the one already fetched (see `prefetchOverride`)
  private overrideFor(name: string, token: string): PromptVersion | null {
    if (!isOverrideToken(token)) return null;
    const cached = this.overrideCache.get(`${name}\0${token}`);
    return cached && cached[0] > this.clock() ? cached[1] : null;
  }

  /**
   * Asks MemTrace which version `token` grants for the prompts in `names` and keeps the answer for 5 minutes, so the
   * synchronous `compile()` of that request can use it. `promptOverrideMiddleware` calls it before the request runs.
   */
  async prefetchOverride(token: string, names: string[] = [...new Set([...this.handles.values()].map((h) => h.name))]): Promise<void> {
    if (!this.source || !isOverrideToken(token)) return;
    const now = this.clock();
    for (const name of names) {
      const cacheKey = `${name}\0${token}`;
      const cached = this.overrideCache.get(cacheKey);
      if (cached && cached[0] > now) continue;
      let granted: PromptVersion | null = null;
      try {
        granted = await this.source.fetchOverride(name, token);
        if (!granted) this.log("warn", `The playground override for prompt '${name}' was not accepted by MemTrace; using the normal version`);
      } catch (error) {
        this.log("warn", `Could not get the playground override of prompt '${name}' (${(error as Error).message}); using the normal version`);
        continue; // transient: do not cache the failure
      }
      if (this.overrideCache.size >= OVERRIDE_CACHE_SIZE) {
        for (const [k, v] of this.overrideCache) if (v[0] <= now) this.overrideCache.delete(k);
        if (this.overrideCache.size >= OVERRIDE_CACHE_SIZE) this.overrideCache.clear();
      }
      this.overrideCache.set(cacheKey, [now + OVERRIDE_CACHE_SECONDS, granted]);
    }
  }

  /** @internal */
  noteUse(version: PromptVersion, playground: boolean): void {
    if (!this.options.annotate || !fromRegistry(version)) return;
    try {
      const attributes: Record<string, unknown> = { [PROMPT_NAME_ATTRIBUTE]: version.name, [PROMPT_VERSION_ATTRIBUTE]: version.version };
      if (playground) attributes[PLAYGROUND_ATTRIBUTE] = true;
      this.options.annotate(attributes);
    } catch { /* instrumentation never breaks the agent */ }
  }

  private async reportUsage(handles: PromptHandle[]): Promise<void> {
    const items: UsedPrompt[] = handles.filter((h) => fromRegistry(h.current)).map((h) => ({ name: h.name, tag: h.tag ?? null, version: h.current.version }));
    if (items.length === 0) { this.nextUsage = this.clock() + this.usageSeconds; return; }
    try {
      await this.options.usage!.report(this.environment, items);
      this.nextUsage = this.clock() + this.usageSeconds;
    } catch {
      this.nextUsage = this.clock() + Math.min(USAGE_RETRY_SECONDS, this.usageSeconds);
    }
  }

  // ----- timer -----

  private ensureTimer(): void {
    if (!this.source || this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return; // a slow pass must not pile up
      this.running = true;
      this.runOnce().catch(() => {}).finally(() => { this.running = false; });
    }, Math.min(TICK_SECONDS, this.refreshSeconds) * 1000);
    this.timer.unref(); // the timer alone never keeps the process alive
  }
}
