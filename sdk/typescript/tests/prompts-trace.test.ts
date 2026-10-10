import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { afterEach, expect, it } from "vitest";
import { initTracer, shutdown, withStep } from "../src/index.js";
import { annotateCurrent } from "../src/tracer.js";
import { PromptRegistry } from "../src/prompts/registry.js";

afterEach(async () => { await shutdown(); });

it("compile() inside a step links the trace to the prompt version", async () => {
  const exporter = new InMemorySpanExporter();
  initTracer({ serviceName: "t", spanExporter: exporter });
  const source = {
    fetch: async () => ({ version: { name: "weather", version: 4, content: "Hi {{x}}", variables: ["x"], contentHash: "h", archived: false, draft: false }, etag: '"v4"' }),
    fetchOverride: async () => null,
  };
  const handle = await new PromptRegistry(source, { environment: "pro", annotate: annotateCurrent, log: () => {} }).get("weather");
  withStep("turn", "chain", () => { handle.compile({ x: "there" }); });
  const attrs = exporter.getFinishedSpans().find((s) => s.name === "turn")!.attributes;
  expect(attrs["memtrace.prompt.name"]).toBe("weather");
  expect(attrs["memtrace.prompt.version"]).toBe(4);
});
