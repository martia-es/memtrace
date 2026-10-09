import { describe, expect, it } from "vitest";
import { agentReadsPrompt, playgroundTargets, promptsUsedBy, replayInputOf } from "@/domain/prompt-playground";
import { assistantCard, deploymentDto, node } from "../fakes";

const chat = { path: "/api/chat", requestField: "message", responseField: "reply", sessionField: null, traceIdField: "trace_id" };
const open = (key: string, status: "up" | "down" = "up") => deploymentDto(key, status, { authMethod: "none" });

describe("playgroundTargets (ADR-071)", () => {
  it("offers the non-production environments that need no credentials, in order", () => {
    const card = assistantCard({ chat, deployments: [open("pre"), open("pro"), open("dev")] });
    const targets = playgroundTargets(card);
    expect(targets.unavailable).toBeNull();
    expect(targets.usable.map((t) => t.deployment.environment.key)).toEqual(["dev", "pre"]); // pro never; dev before pre
    expect(targets.usable[0]!.label).toContain("DEV");
  });

  it("explains that the agent has no chat endpoint before anything else", () => {
    const targets = playgroundTargets(assistantCard({ chat: null, deployments: [open("dev")] }));
    expect(targets.usable).toEqual([]);
    expect(targets.unavailable).toContain("no chat endpoint");
  });

  it("explains that credentials are the problem when only authenticated environments exist", () => {
    const targets = playgroundTargets(assistantCard({ chat, deployments: [deploymentDto("dev", "up"), deploymentDto("pro", "up")] })); // oauth2
    expect(targets.usable).toEqual([]);
    expect(targets.unavailable).toContain("credentials");
  });

  it("explains that production is never used when it is all there is", () => {
    const targets = playgroundTargets(assistantCard({ chat, deployments: [open("pro")] }));
    expect(targets.unavailable).toContain("never runs against production");
  });
});

describe("agentReadsPrompt", () => {
  const usage = (extra: object) => ({ experimentId: "e", environment: "dev", tag: "dev", version: 1, lastSeenAt: "t", active: true, ...extra });

  it("is true when an agent reported this prompt recently in that environment", () => {
    expect(agentReadsPrompt([usage({})], "dev")).toBe(true);
  });

  it("is false for another environment, an old report or no report at all", () => {
    expect(agentReadsPrompt([usage({})], "pre")).toBe(false);
    expect(agentReadsPrompt([usage({ active: false })], "dev")).toBe(false);
    expect(agentReadsPrompt([], "dev")).toBe(false);
  });
});

describe("replayInputOf", () => {
  it("takes the person's last message and the agent's answer from the root span's captured content", () => {
    const root = node({ content: { inputMessages: [{ role: "system", content: "sé breve" }, { role: "user", content: "¿Lloverá en Sevilla?" }], outputMessages: [{ role: "assistant", content: "Sí, mañana." }] } });
    expect(replayInputOf([root])).toEqual({ message: "¿Lloverá en Sevilla?", answer: "Sí, mañana." });
  });

  it("finds them in the model call below when the root span captured nothing", () => {
    const llm = node({ spanId: "s2", content: { inputMessages: [{ role: "user", content: "hola" }], outputMessages: [{ role: "assistant", content: "buenas" }] } });
    expect(replayInputOf([node({ children: [llm] })])).toEqual({ message: "hola", answer: "buenas" });
  });

  it("uses the LAST user message when the trace carries earlier turns", () => {
    const llm = node({ content: { inputMessages: [{ role: "user", content: "primera" }, { role: "assistant", content: "ok" }, { role: "user", content: "segunda" }], outputMessages: [{ role: "assistant", content: "respuesta" }] } });
    expect(replayInputOf([llm]).message).toBe("segunda");
  });

  it("returns nothing when content capture was off", () => {
    expect(replayInputOf([node()])).toEqual({ message: null, answer: null });
    expect(replayInputOf([])).toEqual({ message: null, answer: null });
  });
});

describe("promptsUsedBy", () => {
  const stamped = (name: string, version: string) => node({ attributes: { "memtrace.prompt.name": name, "memtrace.prompt.version": version } });

  it("lists the registry prompts a trace used, wherever in the tree, once each", () => {
    const root = node({ children: [stamped("weather-system", "3"), node({ children: [stamped("tone", "1"), stamped("weather-system", "3")] })] });
    expect(promptsUsedBy([root])).toEqual([{ name: "weather-system", version: 3 }, { name: "tone", version: 1 }]);
  });

  it("is empty for a trace that does not read prompts from the registry", () => {
    expect(promptsUsedBy([node({ children: [node()] })])).toEqual([]);
    expect(promptsUsedBy([node({ attributes: { "memtrace.prompt.name": "x", "memtrace.prompt.version": "oops" } })])).toEqual([]);
  });
});
