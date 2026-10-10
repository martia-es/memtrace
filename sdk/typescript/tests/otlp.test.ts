import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it } from "vitest";
import { flush, initTracer, shutdown, withStep } from "../src/index.js";

afterEach(async () => { await shutdown(); delete process.env.MEMTRACE_OTLP_HEADERS; });

it("exports OTLP/HTTP protobuf to <endpoint>/v1/traces with the configured headers", async () => {
  const requests: Array<{ req: IncomingMessage; body: Buffer }> = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => { requests.push({ req, body: Buffer.concat(chunks) }); res.writeHead(200).end(); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    process.env.MEMTRACE_OTLP_HEADERS = "authorization=Bearer mtk_x";
    initTracer({ serviceName: "otlp-agent", endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
    withStep("turn", "chain", () => undefined);
    await flush();
    expect(requests).toHaveLength(1);
    const { req, body } = requests[0]!;
    expect(req.url).toBe("/v1/traces");
    expect(req.headers["content-type"]).toBe("application/x-protobuf");
    expect(req.headers.authorization).toBe("Bearer mtk_x");
    expect(body.includes("otlp-agent")).toBe(true);
  } finally {
    server.close();
  }
});
