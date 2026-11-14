import { describe, expect, it } from "vitest";
import { describeClause, findingKind, presentFinding, whenOf, type FindingInput } from "@/domain/mem-finding";

const base: FindingInput = {
  cause: "chat | ModelHTTPError: status_code: N, model_name: openai/gpt-oss-Nb, body: {'message': 'Rate limit reached for model `openai/g",
  rule: "goal_cluster=3 > 0.5", decisiveStep: "chat", decisiveError: "ModelHTTPError: status_code: N, body: {'message': 'Rate limit reached",
  support: 35, failures: 32, failureRate: 0.91, lift: 3.5,
};

describe("mem-finding", () => {
  it("clasifica un 429 como límite de peticiones fuera del agente", () => {
    const v = presentFinding(base);
    expect(v.kind).toBe("rate_limit");
    expect(v.infra).toBe(true);
    expect(v.title).not.toMatch(/\bN\b/);
  });

  it("distingue fallos silenciosos y errores de paso", () => {
    expect(findingKind({ cause: "(sin error)", decisiveError: "" })).toBe("silent");
    expect(findingKind({ cause: "search | KeyError: 'id'", decisiveError: "KeyError: 'id'" })).toBe("tool_error");
    expect(presentFinding({ ...base, cause: "search | KeyError", decisiveStep: "search", decisiveError: "KeyError" }).infra).toBe(false);
  });

  it("reconoce timeouts, credenciales y contexto largo", () => {
    expect(findingKind({ cause: "", decisiveError: "Request timed out" })).toBe("timeout");
    expect(findingKind({ cause: "", decisiveError: "401 Unauthorized" })).toBe("auth");
    expect(findingKind({ cause: "", decisiveError: "maximum context length is 8192 tokens" })).toBe("context_length");
  });

  it("traduce la regla del árbol a condiciones legibles", () => {
    expect(describeClause("goal_cluster=3 > 0.5")).toContain("3");
    expect(describeClause("goal_cluster=3 <= 0.5")).toMatch(/Not|Fuera/);
    expect(whenOf("goal_cluster=3 > 0.5 AND goal_cluster=3 > 0.5 | steps > 4")).toHaveLength(2);
    expect(describeClause("algo raro")).toBe("algo raro");
  });
});
