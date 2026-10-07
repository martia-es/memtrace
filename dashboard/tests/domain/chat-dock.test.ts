import { describe, expect, it } from "vitest";
import { canTalkTo, chatUrl, nextVote, normalizeDraft } from "@/domain/chat-dock";

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

describe("nextVote (ADR-062)", () => {
  it("sets a vote, switches it, and clears it when the same button is pressed again", () => {
    expect(nextVote(null, 1)).toBe(1);
    expect(nextVote(undefined, -1)).toBe(-1);
    expect(nextVote(1, -1)).toBe(-1);
    expect(nextVote(-1, -1)).toBeNull();
  });
});
