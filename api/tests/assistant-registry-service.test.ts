import { describe, expect, it, vi } from "vitest";
import { AssistantRegistryService } from "@/application/assistant-registry-service";
import type { AssistantRegistryRepository } from "@/application/ports/assistant-registry-repository";
import type { ChatCallResult, ChatClient } from "@/application/ports/chat-client";
import type { AssistantCard, Connection, Deployment } from "@/domain/assistant-registry";
import { AssistantInvariantError, AssistantNotFoundError, AssistantUpstreamError, ValidationError } from "@/domain/errors";

const NOW = new Date("2026-10-05T12:00:00Z");
const connection = (o: Partial<Connection>): Connection => ({
  id: "c1", experimentId: "e1", kind: "tool", name: "get_forecast", via: null, peerExperimentId: null, declared: true, status: "approved",
  firstSeenAt: null, lastSeenAt: null, decidedBy: null, decidedAt: null, note: null, ...o,
});

function build(repo: Partial<Record<keyof AssistantRegistryRepository, unknown>>, usage: Array<{ tool: string; calls: number; errors: number }> = []) {
  const toolUsage = vi.fn(async () => usage);
  return { service: new AssistantRegistryService(repo as unknown as AssistantRegistryRepository, { toolUsage }, () => NOW), toolUsage };
}

describe("AssistantRegistryService (ADR-053)", () => {
  it("adds 7-day tool usage to tool connections only, with zeros for tools not seen", async () => {
    const { service, toolUsage } = build(
      { listConnections: async () => [connection({ name: "get_forecast" }), connection({ id: "c2", name: "get_alerts" }), connection({ id: "c3", kind: "mcp_server", name: "weather-mcp" })] },
      [{ tool: "get_forecast", calls: 120, errors: 3 }],
    );
    const items = await service.listConnections("e1", "weather-assistant");
    expect(items.map((c) => c.usage)).toEqual([{ calls: 120, errors: 3 }, { calls: 0, errors: 0 }, null]);
    const [, from, to] = toolUsage.mock.calls[0] as unknown as [string, Date, Date];
    expect(to).toEqual(NOW);
    expect(NOW.getTime() - from.getTime()).toBe(7 * 86_400_000);
  });

  it("syncs only tools that were actually called", async () => {
    const recordObservedConnections = vi.fn(async () => {});
    const { service } = build({ getCard: async () => ({}) as AssistantCard, recordObservedConnections }, [
      { tool: "get_forecast", calls: 5, errors: 0 },
      { tool: "idle_tool", calls: 0, errors: 0 },
    ]);
    expect(await service.syncObservedConnections("e1", "svc")).toEqual({ observed: 1 });
    expect(recordObservedConnections).toHaveBeenCalledWith("e1", [{ kind: "tool", name: "get_forecast" }], NOW);
  });

  it("refuses to sync or declare for an experiment that does not exist", async () => {
    const { service } = build({ getCard: async () => null });
    await expect(service.syncObservedConnections("e1", "svc")).rejects.toBeInstanceOf(AssistantNotFoundError);
    await expect(service.declareConnection("e1", { kind: "tool", name: "t" })).rejects.toBeInstanceOf(AssistantNotFoundError);
  });

  it("validates before touching the repository", async () => {
    const createDeployment = vi.fn();
    const { service } = build({ getCard: async () => ({}) as AssistantCard, createDeployment });
    const base = { environmentKey: "pro", healthUrl: null, version: null, authMethod: "none" as const, authProvider: null, authAudience: null, healthCheckEnabled: true, healthIntervalSeconds: null };
    await expect(service.createDeployment("e1", { ...base, apiUrl: "file:///etc/passwd" })).rejects.toBeInstanceOf(ValidationError);
    expect(createDeployment).not.toHaveBeenCalled();
    await expect(service.addGrant("e1", "d1", { subjectType: "group" }, "u1")).rejects.toBeInstanceOf(ValidationError);
  });

  it("does not let an assistant be its own peer agent", async () => {
    const { service } = build({ getCard: async () => ({}) as AssistantCard });
    await expect(service.declareConnection("e1", { kind: "agent", name: "self", peerExperimentId: "e1" })).rejects.toBeInstanceOf(AssistantInvariantError);
  });

  it("turns a missing deployment, grant or connection into not-found", async () => {
    const { service } = build({
      updateDeployment: async () => null, deleteDeployment: async () => false, listGrants: async () => null,
      removeGrant: async () => false, decideConnection: async () => null, listHealthChecks: async () => null,
    });
    await expect(service.updateDeployment("e1", "d1", {})).rejects.toBeInstanceOf(AssistantNotFoundError);
    await expect(service.deleteDeployment("e1", "d1")).rejects.toBeInstanceOf(AssistantNotFoundError);
    await expect(service.listGrants("e1", "d1")).rejects.toBeInstanceOf(AssistantNotFoundError);
    await expect(service.removeGrant("e1", "d1", "g1")).rejects.toBeInstanceOf(AssistantNotFoundError);
    await expect(service.decideConnection("e1", "c1", "approved", "u1", null)).rejects.toBeInstanceOf(AssistantNotFoundError);
    await expect(service.healthHistory("e1", "d1", 24, 10)).rejects.toBeInstanceOf(AssistantNotFoundError);
  });

  it("prunes the health history older than 30 days", async () => {
    const pruneHealthChecks = vi.fn(async () => 7);
    const { service } = build({ pruneHealthChecks });
    expect(await service.pruneHealthHistory()).toBe(7);
    expect(pruneHealthChecks).toHaveBeenCalledWith(new Date("2026-09-05T12:00:00Z"));
  });
});

describe("AssistantRegistryService.chat (ADR-055)", () => {
  const chatConfig = { path: "/api/chat", requestField: "message", responseField: "reply", sessionField: "session_id" };
  const card = (chat: AssistantCard["chat"] = chatConfig) => ({ chat }) as AssistantCard;
  const deployment = (o: Partial<Deployment> = {}) => ({ apiUrl: "https://pro.example.com/", authMethod: "none", ...o }) as Deployment;
  const ok = (body: unknown, httpStatus = 200): ChatCallResult => ({ httpStatus, body, latencyMs: 42, error: null });
  const clientReturning = (result: ChatCallResult) => {
    const send = vi.fn(async () => result);
    return { client: { send } as ChatClient, send };
  };
  const input = { message: " hola ", sessionId: "s1" };

  it("calls the deployment host plus the agent's path with the agent's own field names", async () => {
    const { service } = build({ getCard: async () => card(), getDeployment: async () => deployment() });
    const { client, send } = clientReturning(ok({ reply: "Sunny", session_id: "s2" }));
    expect(await service.chat("e1", "d1", input, client)).toEqual({ reply: "Sunny", sessionId: "s2", latencyMs: 42 });
    expect(send).toHaveBeenCalledWith("https://pro.example.com/api/chat", { message: "hola", session_id: "s1" });
  });

  it("reads a dotted response path and keeps the session when the agent has none", async () => {
    const { service } = build({ getCard: async () => card({ ...chatConfig, responseField: "data.answer", sessionField: null }), getDeployment: async () => deployment() });
    const { client, send } = clientReturning(ok({ data: { answer: "Rain" } }));
    expect(await service.chat("e1", "d1", input, client)).toMatchObject({ reply: "Rain", sessionId: "s1" });
    expect(send).toHaveBeenCalledWith(expect.any(String), { message: "hola" });
  });

  it("refuses when there is no chat endpoint, the deployment needs auth, or the message is empty", async () => {
    const { client, send } = clientReturning(ok({ reply: "x" }));
    await expect(build({ getCard: async () => card(null), getDeployment: async () => deployment() }).service.chat("e1", "d1", input, client)).rejects.toBeInstanceOf(AssistantInvariantError);
    await expect(build({ getCard: async () => card(), getDeployment: async () => deployment({ authMethod: "oauth2" }) }).service.chat("e1", "d1", input, client)).rejects.toBeInstanceOf(AssistantInvariantError);
    await expect(build({ getCard: async () => card(), getDeployment: async () => null }).service.chat("e1", "d1", input, client)).rejects.toBeInstanceOf(AssistantNotFoundError);
    await expect(build({}).service.chat("e1", "d1", { message: "  ", sessionId: null }, client)).rejects.toBeInstanceOf(ValidationError);
    expect(send).not.toHaveBeenCalled();
  });

  it("turns agent failures into upstream errors", async () => {
    const { service } = build({ getCard: async () => card(), getDeployment: async () => deployment() });
    for (const result of [{ httpStatus: null, body: null, latencyMs: null, error: "Connection refused" }, ok({ reply: "x" }, 500), ok({ other: 1 }), ok(null)]) {
      await expect(service.chat("e1", "d1", input, clientReturning(result).client)).rejects.toBeInstanceOf(AssistantUpstreamError);
    }
  });

  it("validates the chat config when it is saved", async () => {
    const update = vi.fn();
    const { service } = build({ update });
    await expect(service.update("e1", { chat: { ...chatConfig, path: "//evil.com/x" } })).rejects.toBeInstanceOf(ValidationError);
    await expect(service.update("e1", { chat: { ...chatConfig, path: "api/chat" } })).rejects.toBeInstanceOf(ValidationError);
    expect(update).not.toHaveBeenCalled();
  });
});
