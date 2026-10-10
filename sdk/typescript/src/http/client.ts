import { settings } from "../config.js";

/** MemTrace answered with an error status. `status` 0 means the request never got an answer (network, timeout). */
export class MemTraceHttpError extends Error {
  constructor(readonly status: number, message: string, readonly detail = "") {
    super(message);
    this.name = "MemTraceHttpError";
  }
}

export interface HttpOptions {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  /** Replaces the global `fetch` (tests). */
  fetch?: typeof fetch;
}

export interface Reply {
  status: number;
  headers: Headers;
  json(): Promise<any>;
}

/** The base URL is the one of the experiment (`.../api/v1/experiments/<id>`) and the API key the agent's (ADR-095). */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(private readonly options: HttpOptions = {}) {
    const url = options.baseUrl ?? settings.apiUrl;
    if (!url) throw new Error("No MemTrace API URL configured; pass baseUrl or set MEMTRACE_API_URL");
    this.baseUrl = url.replace(/\/+$/, "");
    const key = options.apiKey ?? settings.apiKey;
    this.headers = key ? { Authorization: `Bearer ${key}` } : {};
  }

  /** Sends the request; rejects with `MemTraceHttpError` on network failure or timeout, never on an HTTP status. */
  async send(
    method: string, path: string,
    init: { query?: Record<string, string | undefined>; json?: unknown; headers?: Record<string, string> } = {},
  ): Promise<Reply> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(init.query ?? {})) if (value !== undefined) url.searchParams.set(key, value);
    const headers: Record<string, string> = { ...this.headers, ...init.headers };
    if (init.json !== undefined) headers["Content-Type"] = "application/json";
    try {
      const response = await (this.options.fetch ?? fetch)(url, {
        method, headers,
        body: init.json === undefined ? undefined : JSON.stringify(init.json),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
      });
      return { status: response.status, headers: response.headers, json: () => response.json() };
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      throw new MemTraceHttpError(0, message);
    }
  }

  /** `send` that also rejects on an error status, with the server's explanation. */
  async request(method: string, path: string, init: Parameters<HttpClient["send"]>[2] = {}): Promise<Reply> {
    const reply = await this.send(method, path, init);
    if (reply.status >= 400) throw await httpError(reply);
    return reply;
  }
}

export async function detailOf(reply: Reply): Promise<string> {
  try {
    const body = await reply.json();
    return String(body?.detail || body?.title || "");
  } catch {
    return "";
  }
}

export async function httpError(reply: Reply): Promise<MemTraceHttpError> {
  const detail = await detailOf(reply);
  return new MemTraceHttpError(reply.status, `MemTrace answered ${reply.status}${detail ? `: ${detail}` : ""}`, detail);
}
