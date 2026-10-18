import { describe, expect, it, vi } from "vitest";
import { HttpIdentityApi } from "@/adapters/outbound/http-identity-api";

describe("HttpIdentityApi", () => {
  it("marks notifications as read when the server answers 204 without a body", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const api = new HttpIdentityApi("/api/v1", fetchFn);
    await expect(api.markNotificationsRead()).resolves.toBeUndefined();
    expect(fetchFn.mock.calls[0]![0]).toBe("/api/v1/notifications/read");
    expect(fetchFn.mock.calls[0]![1]).toMatchObject({ method: "POST" });
  });
});
