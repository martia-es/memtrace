import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpHealthProber } from "@/adapters/outbound/http/http-health-prober";

// Servidor real en loopback: el adapter se prueba contra sockets de verdad, que es donde vive la protección SSRF.
describe("HttpHealthProber (ADR-053)", () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/ok") res.writeHead(200).end("fine");
      else if (req.url === "/slow") setTimeout(() => res.writeHead(200).end("slow"), 120);
      else if (req.url === "/boom") res.writeHead(503).end("down");
      else if (req.url === "/unauthorized") res.writeHead(401).end();
      else if (req.url === "/redirect") res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data" }).end();
      // /hang: no responde nunca
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const local = () => new HttpHealthProber({ allowPrivateNetworks: true, timeoutMs: 300 });

  it("reports the status code and the time to the first byte of the response", async () => {
    const ok = await local().probe(`${base}/ok`);
    expect(ok).toMatchObject({ httpStatus: 200, error: null });
    expect(ok.latencyMs).toBeGreaterThanOrEqual(0);
    const slow = await local().probe(`${base}/slow`);
    expect(slow.httpStatus).toBe(200);
    expect(slow.latencyMs).toBeGreaterThanOrEqual(100);
    expect(await local().probe(`${base}/boom`)).toMatchObject({ httpStatus: 503 });
    expect(await local().probe(`${base}/unauthorized`)).toMatchObject({ httpStatus: 401 });
  });

  it("does not follow redirects: a 3xx is the answer", async () => {
    expect(await local().probe(`${base}/redirect`)).toMatchObject({ httpStatus: 302, error: null });
  });

  it("gives up after the timeout instead of waiting for ever", async () => {
    const started = Date.now();
    const result = await local().probe(`${base}/hang`);
    expect(result).toMatchObject({ httpStatus: null, latencyMs: null });
    expect(result.error).toMatch(/No response/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("turns a refused connection into a result, not an exception", async () => {
    const closed = http.createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));
    expect(await local().probe(`http://127.0.0.1:${port}/health`)).toMatchObject({ httpStatus: null, error: "Connection refused" });
  });

  it("refuses private, loopback and metadata addresses by default, even by hostname", async () => {
    const strict = new HttpHealthProber({ timeoutMs: 300 });
    expect((await strict.probe(`${base}/ok`)).error).toMatch(/not allowed/);
    expect((await strict.probe("http://localhost:1/health")).error).toMatch(/not allowed/);
    expect((await strict.probe("http://[::1]:1/health")).error).toMatch(/not allowed/);
    expect((await strict.probe("http://10.0.0.5/health")).error).toMatch(/not allowed/);
  });

  it("never reaches the cloud metadata address, even when private networks are allowed", async () => {
    const result = await local().probe("http://169.254.169.254/latest/meta-data");
    expect(result).toMatchObject({ httpStatus: null });
    expect(result.error).toMatch(/not allowed/);
  });

  it("rejects what is not a plain http(s) URL without opening a socket", async () => {
    for (const url of ["file:///etc/passwd", "gopher://x", "https://user:pw@example.com", "not a url"]) {
      expect((await local().probe(url)).error, url).toMatch(/plain http/);
    }
  });
});
