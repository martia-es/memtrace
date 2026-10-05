import { describe, expect, it } from "vitest";
import { canTalkTo, chatUrl, normalizeDraft } from "@/domain/chat-dock";

describe("chat dock rules (ADR-055)", () => {
  it("ignores blank drafts and trims the rest", () => {
    expect(normalizeDraft("   \n")).toBeNull();
    expect(normalizeDraft("  hola ")).toBe("hola");
  });

  it("offers Talk only with a chat endpoint and an unauthenticated deployment", () => {
    const d = { authMethod: "none", apiUrl: "https://x.test" };
    expect(canTalkTo({ chat: { path: "/api/chat" } }, d)).toBe(true);
    expect(canTalkTo({ chat: null }, d)).toBe(false);
    expect(canTalkTo({ chat: { path: "/api/chat" } }, { ...d, authMethod: "oauth2" })).toBe(false);
  });

  it("joins the deployment host and the agent path without a double slash", () => {
    expect(chatUrl("https://pro.test/", "/api/chat")).toBe("https://pro.test/api/chat");
  });
});
