import { describe, expect, it } from "vitest";
import { HttpAssistantApi } from "@/adapters/outbound/http-assistant-api";

describe("HttpAssistantApi.sendFeedback", () => {
  it("posts the rating under /api/v1 once (no duplicated prefix)", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    await new HttpAssistantApi("/api/v1", fetchFn).sendFeedback("exp 1", "abc", -1);

    expect(calls[0].url).toBe("/api/v1/experiments/exp%201/traces/abc/feedback");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ rating: -1 });
  });
});
