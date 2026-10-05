import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpChatClient } from "@/adapters/outbound/http/http-chat-client";

let server: http.Server;
let base: string;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.url === "/echo") return res.end(JSON.stringify({ got: JSON.parse(raw), method: req.method }));
      if (req.url === "/text") return res.end("not json");
      if (req.url === "/redirect") return res.writeHead(302, { Location: "http://169.254.169.254/" }).end();
      res.writeHead(500).end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe("HttpChatClient (ADR-055)", () => {
  const local = () => new HttpChatClient({ allowPrivateNetworks: true });

  it("POSTs the JSON body and parses the JSON answer", async () => {
    const r = await local().send(`${base}/echo`, { message: "hi" });
    expect(r).toMatchObject({ httpStatus: 200, error: null, body: { got: { message: "hi" }, method: "POST" } });
  });

  it("returns a null body for non-JSON and does not follow redirects", async () => {
    expect((await local().send(`${base}/text`, { message: "hi" })).body).toBeNull();
    expect((await local().send(`${base}/redirect`, { message: "hi" })).httpStatus).toBe(302);
  });

  it("blocks private addresses by default and the cloud metadata address always", async () => {
    expect((await new HttpChatClient().send(`${base}/echo`, { message: "hi" })).error).toMatch(/not allowed/);
    expect((await local().send("http://169.254.169.254/latest", { message: "hi" })).error).toMatch(/not allowed/);
  });

  it("reports a refused connection as a result, not a throw", async () => {
    expect((await local().send("http://127.0.0.1:1/x", { message: "hi" })).error).toBe("Connection refused");
  });
});
