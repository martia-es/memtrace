import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Redactor } from "../src/redaction.js";
import { parseHeaders, resolveRevision } from "../src/config.js";
import { currentTraceId, flush, initTracer, session, shutdown, traceStep, withStep } from "../src/index.js";

describe("redaction by value", () => {
  const redactor = new Redactor();
  it.each([
    ["Bearer abcdefgh12345678", "Bearer ****"],
    ["key sk-abcdefghijklmnopqrstu", "key ****"],
    ["postgres://user:hunter2@host/db", "postgres://****@host/db"],
    ["password=hunter2 next", "password=**** next"],
    ["token mtk_abcdefghij12345", "token ****"],
  ])("%s", (input, expected) => expect(redactor.scrubText(input)).toBe(expected));

  it("masks the value of a sensitive key but keeps token counts", async () => {
    expect(await redactor.attribute("api_key", "x")).toBe("****");
    expect(await redactor.attribute("gen_ai.usage.input_tokens", 7)).toBe(7);
  });
});

describe("config", () => {
  it("parses OTLP headers", () => expect(parseHeaders("a=1, b = 2,bad,=x")).toEqual({ a: "1", b: "2" }));
  it("reads the commit from the environment first", () => {
    process.env.MEMTRACE_GIT_SHA = "ABCDEF1234567";
    try { expect(resolveRevision()).toEqual({ sha: "abcdef1234567" }); } finally { delete process.env.MEMTRACE_GIT_SHA; }
  });
});

describe("steps", () => {
  let exporter: InMemorySpanExporter;
  beforeEach(() => { exporter = new InMemorySpanExporter(); initTracer({ serviceName: "t", spanExporter: exporter }); });
  afterEach(async () => { await shutdown(); delete process.env.MEMTRACE_CAPTURE_CONTENT; });
  const byName = (name: string) => exporter.getFinishedSpans().find((s) => s.name === name)!;


  it("keeps parentage and the session across awaits", async () => {
    await session("conv-1", () => withStep("turn", "chain", async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await withStep("inner", "tool", async () => { await Promise.resolve(); });
    }));
    await flush();
    expect(byName("inner").parentSpanContext?.spanId).toBe(byName("turn").spanContext().spanId);
    expect(byName("inner").attributes["gen_ai.conversation.id"]).toBe("conv-1");
  });

  it("returns the result and rethrows a rejection with ERROR status", async () => {
    await expect(withStep("ok", "chain", async () => 42)).resolves.toBe(42);
    await expect(withStep("bad", "chain", async () => { throw new Error("nope"); })).rejects.toThrow("nope");
    await flush();
    expect(byName("bad").status).toMatchObject({ code: 2, message: "nope" });
  });

  it("traceStep records arguments and result only with content capture on", async () => {
    // initTracer is idempotent and shutdown() also stops its exporter, so restart with a new one to read the setting
    await shutdown();
    process.env.MEMTRACE_CAPTURE_CONTENT = "true";
    exporter = new InMemorySpanExporter();
    initTracer({ serviceName: "t", spanExporter: exporter });
    const search = traceStep((q: string, apiKey: string) => `found ${q}`, { name: "search", stepType: "tool" });
    expect(search("cats", "sk-secret")).toBe("found cats");
    await flush();
    expect(JSON.parse(byName("search").attributes["gen_ai.tool.call.arguments"] as string)).toEqual(["cats", "sk-secret"]);
    expect(byName("search").attributes["gen_ai.tool.call.result"]).toBe('"found cats"');
  });

  it("exposes the trace id inside a step and nothing outside", () => {
    expect(currentTraceId()).toBeUndefined();
    withStep("a", "chain", () => expect(currentTraceId()).toMatch(/^[0-9a-f]{32}$/));
  });

  it("runs the callback untraced when tracing is off", async () => {
    await shutdown();
    expect(withStep("x", "chain", () => 1)).toBe(1);
  });
});
