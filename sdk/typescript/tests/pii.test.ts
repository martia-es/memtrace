import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ENTITIES, flush, initTracer, maskRanges, presidioRedactor, shutdown, textHook, withStep } from "../src/index.js";

/** A stand-in for the Presidio analyzer: it "recognizes" María García and anything that looks like an email. */
function fakePresidio(supported = ["PERSON", "EMAIL_ADDRESS", "LOCATION"]) {
  const analyzed: any[] = [];
  const state = { down: false };
  const server: Server = createServer((req, res) => {
    if (state.down) { res.writeHead(503).end(); return; }
    if (req.url?.startsWith("/supportedentities")) { res.writeHead(200).end(JSON.stringify(supported)); return; }
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      analyzed.push(body);
      const findings = [...body.text.matchAll(/María García|[\w.]+@[\w.]+/g)].map((m) => ({ start: m.index, end: m.index + m[0].length, entity_type: "X", score: 0.9 }));
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(findings));
    });
  });
  const listening = new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  return { server, url: listening, analyzed, state };
}

describe("maskRanges", () => {
  it("masks each range with ****, merging overlapping or touching ones", () => {
    expect(maskRanges("call 600123456 now", [{ start: 5, end: 14 }])).toBe("call **** now");
    expect(maskRanges("abcdefghij", [{ start: 1, end: 4 }, { start: 3, end: 6 }, { start: 8, end: 9 }])).toBe("a****gh****j");
    expect(maskRanges("nothing", [])).toBe("nothing");
  });
});

describe("textHook", () => {
  it("transforms every string and keeps the structure and the keys", async () => {
    const hook = textHook((t) => t.replace("María", "****"));
    expect(await hook([{ role: "user", content: "soy María", tokens: 3 }, "adiós María"])).toEqual([{ role: "user", content: "soy ****", tokens: 3 }, "adiós ****"]);
  });
});

describe("presidioRedactor", () => {
  let fake: ReturnType<typeof fakePresidio>;
  beforeEach(() => { fake = fakePresidio(); });
  afterEach(async () => { fake.server.close(); await shutdown(); });

  it("asks only for the supported entities of the default list, with the options it was given", async () => {
    const hook = await presidioRedactor({ url: await fake.url, language: "es", scoreThreshold: 0.6, allowList: ["Acme"] });
    await hook("Hola, soy María García");
    expect(fake.analyzed[0]).toMatchObject({ language: "es", entities: ["PERSON", "EMAIL_ADDRESS"], score_threshold: 0.6, allow_list: ["Acme"] });
    expect(DEFAULT_ENTITIES).toContain("ES_NIF");
  });

  it("masks personal data inside the content of a span before it is exported, and leaves ids and counts alone", async () => {
    const exporter = new InMemorySpanExporter();
    process.env.MEMTRACE_CAPTURE_CONTENT = "true";
    try {
      initTracer({ serviceName: "t", spanExporter: exporter, redact: await presidioRedactor({ url: await fake.url }) });
      withStep("turn", "chain", (step) => step.setAttributes({
        "memtrace.input": JSON.stringify([{ role: "user", content: "Hola, soy María García, mi correo es maria@example.com" }]),
        "gen_ai.usage.input_tokens": 12,
      }));
      await flush();
    } finally { delete process.env.MEMTRACE_CAPTURE_CONTENT; }
    const attrs = exporter.getFinishedSpans()[0]!.attributes;
    expect(JSON.parse(attrs["memtrace.input"] as string)).toEqual([{ role: "user", content: "Hola, soy ****, mi correo es ****" }]);
    expect(attrs["gen_ai.usage.input_tokens"]).toBe(12);
  });

  it("analyzes a repeated text once", async () => {
    const hook = await presidioRedactor({ url: await fake.url });
    await Promise.all([hook("soy María García"), hook("soy María García")]);
    await hook("soy María García");
    expect(fake.analyzed).toHaveLength(1);
  });

  it("does not send what cannot contain personal data", async () => {
    const hook = await presidioRedactor({ url: await fake.url });
    expect(await hook(["ok", "...", "   ", "12"])).toEqual(["ok", "...", "   ", "12"]); // too short, or no letters or digits
    expect(fake.analyzed).toHaveLength(0);
  });

  it("fails at startup if the service is unreachable or supports none of the entities", async () => {
    await expect(presidioRedactor({ url: "http://127.0.0.1:1", timeoutMs: 500 })).rejects.toThrow("Could not reach the Presidio analyzer");
    const none = fakePresidio(["LOCATION"]);
    try { await expect(presidioRedactor({ url: await none.url })).rejects.toThrow("None of the requested entities"); } finally { none.server.close(); }
  });

  it("never exports personal data unmasked: if the service goes down the content is replaced", async () => {
    const exporter = new InMemorySpanExporter();
    initTracer({ serviceName: "t", spanExporter: exporter, redact: await presidioRedactor({ url: await fake.url }) });
    fake.state.down = true;
    withStep("turn", "chain", (step) => step.setAttributes({ "memtrace.input": "soy María García" }));
    await flush();
    expect(exporter.getFinishedSpans()[0]!.attributes["memtrace.input"]).toBe("[UNSERIALIZABLE]");
  });
});
