import { describe, expect, it } from "vitest";
import { classifyError, extractHttpStatus, normalizeMessage, summarizeErrors, type ErrorGroup, type ErrorGroupsResult } from "@/domain/error-categories";

const signal = (message: string, kind = "tool", exceptionType = "") => ({ kind, message, exceptionType });

describe("extractHttpStatus", () => {
  it("reads explicit statuses only", () => {
    expect(extractHttpStatus("HTTP 503 from upstream")).toBe(503);
    expect(extractHttpStatus("429 Too Many Requests")).toBe(429);
    expect(extractHttpStatus("status_code=401")).toBe(401);
    expect(extractHttpStatus("returned 500 items")).toBeNull();
    expect(extractHttpStatus("")).toBeNull();
  });
});

describe("classifyError", () => {
  it.each([
    ["429 Too Many Requests", "tool", "", "quota_exceeded"],
    ["RESOURCE_EXHAUSTED: Quota exceeded for gemini-2.5-pro", "llm", "", "quota_exceeded"],
    ["This model's maximum context length is 8192 tokens", "llm", "", "context_too_long"],
    ["Response blocked by safety settings", "llm", "", "safety_blocked"],
    ["request timed out after 30s", "tool", "", "timeout"],
    ["", "tool", "httpx.ReadTimeout", "timeout"],
    ["HTTP 503 Service Unavailable", "tool", "", "service_unavailable"],
    ["Connection refused", "tool", "", "service_unavailable"],
    ["401 Unauthorized: invalid api key", "tool", "", "access_denied"],
    ["status 404 not found", "tool", "", "not_found"],
    ["HTTP 422 validation error", "tool", "", "invalid_request"],
    ["", "tool", "asyncio.CancelledError", "cancelled"],
  ])("%j (%s, %s) -> %s", (message, kind, exceptionType, expected) => {
    expect(classifyError(signal(message, kind, exceptionType)).id).toBe(expected);
  });

  it("prefers quota over a generic 4xx and timeout over 5xx", () => {
    expect(classifyError(signal("HTTP 429: quota exceeded")).id).toBe("quota_exceeded");
    expect(classifyError(signal("HTTP 504 gateway timeout")).id).toBe("timeout");
  });

  it("falls back by step kind", () => {
    expect(classifyError(signal("boom", "tool")).id).toBe("other_tool");
    expect(classifyError(signal("boom", "llm")).id).toBe("other_model");
    expect(classifyError(signal("boom", "guardrail")).id).toBe("other");
  });
});

describe("normalizeMessage", () => {
  it("collapses ids and numbers so repeated failures group together", () => {
    expect(normalizeMessage("user 4821 missing, req 123e4567-e89b-12d3-a456-426614174000")).toBe("user # missing, req <id>");
  });
});

const group = (over: Partial<ErrorGroup>): ErrorGroup => ({
  kind: "tool", name: "get_weather", message: "boom", exceptionType: "", occurrences: 1, traces: 1, conversations: 1, firstSeenMs: 100, lastSeenMs: 200, ...over,
});
const result = (groups: ErrorGroup[], extra: Partial<ErrorGroupsResult> = {}): ErrorGroupsResult => ({
  groups, tracesWithErrors: 10, conversationsWithErrors: 8, totalTraces: 100, totalConversations: 50, ...extra,
});
const range = { fromMs: 1000, toMs: 2000 };
const prev = { fromMs: 0, toMs: 1000 };

describe("summarizeErrors", () => {
  it("merges groups of the same category, ranks by severity then volume and compares with the previous period", () => {
    const current = result([
      group({ message: "429 Too Many Requests", name: "search", occurrences: 5, traces: 5, conversations: 4 }),
      group({ message: "rate limit hit for user 7", name: "search", occurrences: 3, traces: 3, conversations: 3, lastSeenMs: 900 }),
      group({ message: "not found", name: "lookup", occurrences: 50, traces: 9, conversations: 9 }),
    ]);
    const previous = result([group({ message: "429 Too Many Requests", occurrences: 2 })]);
    const out = summarizeErrors(current, previous, range, prev);

    expect(out.categories.map((c) => c.id)).toEqual(["quota_exceeded", "not_found"]);
    const quota = out.categories[0]!;
    expect(quota).toMatchObject({ occurrences: 8, previousOccurrences: 2, lastSeenMs: 900 });
    expect(quota.affected).toEqual([{ kind: "tool", name: "search", occurrences: 8 }]);
    expect(out.totals.occurrences).toBe(58);
  });

  it("never reports more affected traces or conversations than exist", () => {
    const current = result([group({ message: "timeout", traces: 6, conversations: 6 }), group({ message: "timed out again", traces: 6, conversations: 6 })], { tracesWithErrors: 7, conversationsWithErrors: 7 });
    const [timeout] = summarizeErrors(current, null, range, null).categories;
    expect(timeout).toMatchObject({ traces: 7, conversations: 7, previousOccurrences: 0 });
  });

  it("returns no categories when nothing failed", () => {
    expect(summarizeErrors(result([]), null, range, null).categories).toEqual([]);
  });
});
