import { describe, expect, it } from "vitest";
import { TraceQueryService } from "@/application/trace-query-service";
import type { ConversationSummary } from "@/domain/conversation";
import { ConversationNotFoundError, ValidationError } from "@/domain/errors";
import { MAX_RANGE_MS } from "@/domain/time-range";
import { FakeTraceRepository } from "../helpers";

const NOW = Date.parse("2026-09-26T12:00:00Z");
const conversation = (id: string): ConversationSummary => ({
  conversationId: id, serviceNames: ["svc"], startTimeUs: 1, lastActivityUs: 2, turnCount: 2,
  errorTurns: 0, failedSpans: 0, totalTokens: 10, activeMs: 5, prompts: [],
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

  it("titles each conversation with the user's first message and prices it from the catalog", async () => {
    const { repo, service } = setup();
    repo.conversationPage = { items: [conversation("c1"), conversation("c2"), conversation("c3")], nextCursor: null };
    repo.modelPricing = [{ modelId: "gpt-4o-mini", provider: "openai", inputPricePerToken: 0.000001, outputPricePerToken: 0.000002, source: "litellm", updatedAtMs: 0 }];
    repo.conversationUsage.set("c1", {
      firstInput: JSON.stringify([{ role: "system", content: "Be brief" }, { role: "user", content: "Do I need an  umbrella\nin Bilbao?" }]),
      models: [{ model: "gpt-4o-mini", inputTokens: 1000, outputTokens: 500 }, { model: "unpriced-model", inputTokens: 5, outputTokens: 5 }],
    });
    repo.conversationUsage.set("c2", { firstInput: null, models: [{ model: "unpriced-model", inputTokens: 10, outputTokens: 10 }] });
    // c3 has no spans of chat at all

    const { items } = await service.listConversations({});
    const [c1, c2, c3] = items;
    expect(c1).toMatchObject({ conversationId: "c1", title: "Do I need an umbrella in Bilbao?" });
    expect(c1!.costUsd).toBeCloseTo(0.002, 6); // only the models with a known price add up
    expect(c2).toMatchObject({ title: null, costUsd: null }); // no content captured, no known price
    expect(c3).toMatchObject({ title: null, costUsd: null });
  });

  it("caps the title at 120 characters", async () => {
    const { repo, service } = setup();
    repo.conversationPage = { items: [conversation("c1")], nextCursor: null };
    repo.conversationUsage.set("c1", { firstInput: JSON.stringify([{ role: "user", content: "x".repeat(300) }]), models: [] });
    const { items } = await service.listConversations({});
    expect(items[0]!.title).toHaveLength(120);
  });

  it("gives the detail the same title and cost", async () => {
    const { repo, service } = setup();
    repo.conversations.set("c1", conversation("c1"));
    repo.conversationUsage.set("c1", { firstInput: JSON.stringify([{ role: "user", content: "Hola" }]), models: [] });
    const detail = await service.getConversation("c1");
    expect(detail.conversation).toMatchObject({ title: "Hola", costUsd: null });
  });

  it("throws ConversationNotFoundError for an unknown conversation", async () => {
    const { service } = setup();
    await expect(service.getConversation("nope")).rejects.toBeInstanceOf(ConversationNotFoundError);
  });
});
