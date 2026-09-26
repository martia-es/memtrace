import { describe, expect, it, vi } from "vitest";
import { HttpTraceApi } from "@/adapters/outbound/http-trace-api";
import { ApiError } from "@/application/trace-api";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

describe("HttpTraceApi", () => {
  it("builds the query string skipping undefined values", async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok({ items: [], nextCursor: null }));
    const api = new HttpTraceApi("/api/v1", fetchFn);
    await api.listTraces({ from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z", service: undefined, hasErrors: true, limit: 50 });
    const url = new URL(fetchFn.mock.calls[0]![0] as string, "http://x");
    expect(url.pathname).toBe("/api/v1/traces");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-02T00:00:00.000Z",
      hasErrors: "true",
      limit: "50",
    });
  });

  it("encodes the trace id in the path", async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok({}));
    await new HttpTraceApi("/api/v1", fetchFn).getTrace("a/b");
    expect(fetchFn.mock.calls[0]![0]).toBe("/api/v1/traces/a%2Fb");
  });

  it("turns problem+json into an ApiError with field errors", async () => {
    const problem = { type: "about:blank", title: "Bad Request", status: 400, detail: "Invalid request", errors: { limit: "too big" } };
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify(problem), { status: 400, headers: { "Content-Type": "application/problem+json" } }));
    const error = await new HttpTraceApi("/api/v1", fetchFn).listTraces({ from: "a", to: "b" }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, title: "Bad Request", detail: "Invalid request", fields: { limit: "too big" } });
  });

  it("handles non-JSON error bodies", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" }));
    const error = await new HttpTraceApi("/api/v1", fetchFn).listServices({ from: "a", to: "b" }).catch((e) => e);
    expect(error).toMatchObject({ status: 502, title: "Bad Gateway" });
  });

  it("maps network failures to status 0 but lets aborts through", async () => {
    const offline = new HttpTraceApi("/api/v1", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(offline.getTrace("x")).rejects.toMatchObject({ status: 0 });
    const aborted = new HttpTraceApi("/api/v1", vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")));
    await expect(aborted.getTrace("x")).rejects.toMatchObject({ name: "AbortError" });
  });
});
