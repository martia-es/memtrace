import { HttpClient, detailOf, type HttpOptions } from "../http/client.js";
import { MemTraceHttpError } from "../http/client.js";
import {
  PromptNotFoundError, PromptSourceError, type Fetched, type PromptSource, type PromptVersion, type UsageSink, type UsedPrompt,
} from "./domain.js";

function parseVersion(body: any): PromptVersion {
  return {
    name: body.name,
    version: Number(body.version),
    content: body.content,
    variables: [...(body.variables ?? [])],
    contentHash: body.contentHash ?? "",
    archived: Boolean(body.archived ?? false),
    draft: Boolean(body.draft ?? false),
  };
}

/** Implements `PromptSource` and `UsageSink` over the experiment's API. Short timeouts: it must never hold an agent back. */
export class HttpPromptClient implements PromptSource, UsageSink {
  private readonly http: HttpClient;

  constructor(options: HttpOptions = {}) {
    this.http = new HttpClient({ timeoutMs: 3000, ...options });
  }

  private async send(method: string, path: string, init: Parameters<HttpClient["send"]>[2] = {}) {
    try {
      return await this.http.send(method, path, init);
    } catch (error) {
      throw new PromptSourceError(error instanceof MemTraceHttpError ? error.message : String(error));
    }
  }

  async fetch(name: string, tag: string | undefined, version: number | undefined, etag: string | null): Promise<Fetched | null> {
    const reply = await this.send("GET", "/prompts/resolve", {
      query: { name, tag, version: version === undefined ? undefined : String(version) },
      headers: etag ? { "If-None-Match": etag } : undefined,
    });
    if (reply.status === 304) return null;
    if (reply.status === 404) throw new PromptNotFoundError((await detailOf(reply)) || `Prompt '${name}' not found for this agent`);
    if (reply.status >= 400) throw new PromptSourceError(`MemTrace answered ${reply.status}: ${await detailOf(reply)}`);
    return { version: parseVersion(await reply.json()), etag: reply.headers.get("ETag") };
  }

  async fetchOverride(name: string, token: string): Promise<PromptVersion | null> {
    const reply = await this.send("GET", "/prompts/resolve", { query: { name, override: token } });
    if (reply.status === 404) return null;
    if (reply.status >= 400) throw new PromptSourceError(`MemTrace answered ${reply.status}: ${await detailOf(reply)}`);
    return parseVersion(await reply.json());
  }

  /** Saves `content` as a DRAFT of prompt `name` (ADR-072). A tool can propose; only a person publishes. */
  async saveDraft(name: string, content: string, extra: {
    message?: string; basedOn?: number; traceIds?: string[]; cause?: string; rationale?: string;
  } = {}): Promise<{ promptId: string; version: number }> {
    const reply = await this.send("POST", "/prompts/drafts", {
      json: {
        name, content, message: extra.message ?? "", basedOn: extra.basedOn ?? null,
        origin: { traceIds: extra.traceIds ?? [], cause: extra.cause ?? null, rationale: extra.rationale ?? "" },
      },
    });
    if (reply.status >= 400) throw new PromptSourceError(`MemTrace answered ${reply.status}: ${await detailOf(reply)}`);
    const body = await reply.json();
    return { promptId: String(body.promptId), version: Number(body.version) };
  }

  async report(environment: string | undefined, items: UsedPrompt[]): Promise<void> {
    const reply = await this.send("POST", "/prompts/usage", {
      json: { environment: environment ?? null, items: items.map((i) => ({ name: i.name, tag: i.tag, version: i.version })) },
    });
    if (reply.status >= 400) throw new PromptSourceError(`MemTrace answered ${reply.status}: ${await detailOf(reply)}`);
  }
}
