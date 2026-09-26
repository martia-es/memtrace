import { describe, expect, it } from "vitest";
import { TraceQueryService } from "@/application/trace-query-service";
import type { ConversationSummary } from "@/domain/conversation";
import { ConversationNotFoundError, ValidationError } from "@/domain/errors";
import { MAX_RANGE_MS } from "@/domain/time-range";
import { FakeTraceRepository } from "../helpers";

const NOW = Date.parse("2026-09-26T12:00:00Z");
const conversation = (id: string): ConversationSummary => ({
  conversationId: id, serviceNames: ["svc"], startTimeUs: 1, lastActivityUs: 2, turnCount: 2,
  errorTurns: 0, failedSpans: 0, totalTokens: 10, activeMs: 5,
});

function setup() {
  const repo = new FakeTraceRepository();
  return { repo, service: new TraceQueryService(repo, () => NOW) };
}

describe("conversations", () => {
  it("lists with the default range and page size", async () => {
    const { repo, service } = setup();
    await service.listConversations({ service: "svc", hasErrors: true });
    expect(repo.lastConversationQuery).toMatchObject({ limit: 50, toMs: NOW, service: "svc", hasErrors: true });
    expect(repo.lastConversationQuery!.toMs - repo.lastConversationQuery!.fromMs).toBe(24 * 3600_000);
  });

  it.each([0, 201])("rejects limit %s", (limit) => {
    const { service } = setup();
    expect(() => service.listConversations({ limit })).toThrow(ValidationError);
  });

  it("returns the summary with its turns in chronological order, over the whole retention", async () => {
    const { repo, service } = setup();
    repo.conversations.set("c1", conversation("c1"));
    const detail = await service.getConversation("c1", { limit: 20 });
    expect(detail.conversation.conversationId).toBe("c1");
    expect(repo.lastConversationRange).toEqual({ fromMs: NOW - MAX_RANGE_MS, toMs: NOW });
    expect(repo.lastListQuery).toMatchObject({ conversationId: "c1", order: "asc", limit: 20, fromMs: NOW - MAX_RANGE_MS });
  });

  it("throws ConversationNotFoundError for an unknown conversation", async () => {
    const { service } = setup();
    await expect(service.getConversation("nope")).rejects.toBeInstanceOf(ConversationNotFoundError);
  });
});
