import { describe, expect, it } from "vitest";
import { buildEvalEnv, buildEvalInstall, buildEvalScript, pendingSecrets, runName, type EvalScriptInput } from "@/domain/eval-script";

const agent = { environment: "DEV", url: "https://dev.acme.test/weather/chat", requestField: "message", responseField: "reply", needsAuth: false };
const base: EvalScriptInput = {
  origin: "https://memtrace.acme.test",
  experimentId: "exp-1",
  serviceName: "weather-assistant",
  datasetId: "ds-1",
  datasetName: "Refund questions",
  version: "1.2",
  metrics: ["exact_match", "correctness"],
  agent,
};

describe("offline evaluation script", () => {
  it("calls the agent with its own JSON contract and pins the dataset version", () => {
    const script = buildEvalScript(base);
    expect(script).toContain('json={"message": item.input}');
    expect(script).toContain('return body["reply"]');
    expect(script).toContain('dataset_version="1.2"');
    expect(script).toContain("evaluators=[exact_match, Correctness(client=AnthropicJudgeClient())]");
    expect(script).toContain("from memtrace.eval import EvalItem, exact_match, run_experiment");
    expect(script).toContain('name="refund-questions-1.2-dev"');
  });

  it("reads the latest version when none is pinned, and imports only what it uses", () => {
    const script = buildEvalScript({ ...base, version: null, metrics: ["contains"] });
    expect(script).not.toContain("dataset_version");
    expect(script).not.toContain("AnthropicJudgeClient");
    expect(script).toContain("from memtrace.eval import EvalItem, contains, run_experiment");
  });

  it("walks a dotted response field and sends the Authorization header of authenticated deployments", () => {
    const script = buildEvalScript({ ...base, agent: { ...agent, responseField: "data.answer", requestField: "q", needsAuth: true } });
    expect(script).toContain("from functools import reduce");
    expect(script).toContain('reduce(lambda part, key: part[key], ["data","answer"], body)');
    expect(script).toContain('json={"q": item.input}');
    expect(script).toContain('headers={"Authorization": os.environ["AGENT_AUTHORIZATION"]}');
  });

  it("leaves a function to fill in when the agent declares no chat", () => {
    const script = buildEvalScript({ ...base, agent: null });
    expect(script).toContain("raise NotImplementedError");
    expect(script).not.toContain("import httpx");
    expect(buildEvalEnv({ ...base, agent: null })).not.toContain("AGENT_URL");
    expect(buildEvalInstall({ agent: null })).not.toContain("httpx");
  });

  it("writes a .env with everything filled in except the secrets", () => {
    const env = buildEvalEnv(base);
    expect(env).toContain('MEMTRACE_API_URL="https://memtrace.acme.test/api/v1/experiments/exp-1"');
    expect(env).toContain('MEMTRACE_DATASET_ID="ds-1"');
    expect(env).toContain('MEMTRACE_SERVICE_NAME="weather-assistant"');
    expect(env).toContain('MEMTRACE_OTLP_ENDPOINT="https://memtrace.acme.test/api/v1/ingest"');
    expect(env).toContain('AGENT_URL="https://dev.acme.test/weather/chat"');
    expect(env).toContain('MEMTRACE_API_KEY="PASTE_YOUR_MEMTRACE_API_KEY"');
    expect(env).toContain('ANTHROPIC_API_KEY="PASTE_YOUR_ANTHROPIC_API_KEY"');
    expect(buildEvalEnv({ ...base, metrics: ["exact_match"] })).not.toContain("ANTHROPIC_API_KEY");
  });

  it("lists the secrets still to fill in", () => {
    expect(pendingSecrets(base)).toEqual(["MEMTRACE_API_KEY", "ANTHROPIC_API_KEY"]);
    expect(pendingSecrets({ metrics: ["contains"], agent: { ...agent, needsAuth: true } })).toEqual(["MEMTRACE_API_KEY", "AGENT_AUTHORIZATION"]);
  });

  it("names the run after dataset, version and environment", () => {
    expect(runName({ datasetName: "Weather / basics!", version: null, agent })).toBe("weather-basics-latest-dev");
  });

  it("escapes names so the generated Python stays valid", () => {
    expect(buildEvalScript({ ...base, datasetName: 'Say "hi"' })).toContain('"Say \\"hi\\""');
  });
});
