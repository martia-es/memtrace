import { createHmac, createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GithubAppDispatcher, UnconfiguredDispatcher, appJwt } from "@/adapters/outbound/github/github-app-dispatcher";
import { parseWorkflowRunEvent, verifyGithubSignature } from "@/adapters/inbound/http/github-webhook";
import { AssistantUpstreamError, CiUnavailableError } from "@/domain/errors";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const SHA = "3a08213f9b1c2d4e5f60718293a4b5c6d7e8f901";
const repo = { url: "https://github.com/acme/weather", provider: "github" as const, deployWorkflow: "deploy.yml" };

function fakeGithub(overrides: Record<string, () => Response> = {}) {
  const calls: Array<{ url: string; method: string; auth: string | null; body: unknown }> = [];
  const http = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    calls.push({ url, method: init.method ?? "GET", auth: headers.Authorization ?? null, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const path = url.replace("https://api.github.com", "");
    const key = `${init.method} ${path}`;
    if (overrides[key]) return overrides[key]!();
    if (key === "GET /repos/acme/weather/installation") return Response.json({ id: 42 });
    if (key === "POST /app/installations/42/access_tokens") return Response.json({ token: "inst-token", expires_at: new Date(Date.now() + 3600_000).toISOString() });
    if (key === "GET /repos/acme/weather/commits/main") return Response.json({ sha: SHA });
    if (key === "POST /repos/acme/weather/actions/workflows/deploy.yml/dispatches") return new Response(null, { status: 204 });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { http, calls };
}

describe("GithubAppDispatcher (ADR-064)", () => {
  it("signs the App JWT with RS256 and the App id", () => {
    const jwt = appJwt({ appId: "123", privateKey }, 1_700_000_000);
    const [header, payload, signature] = jwt.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toMatchObject({ iss: "123" });
    expect(createVerify("RSA-SHA256").update(`${header}.${payload}`).verify(publicKey, Buffer.from(signature, "base64url"))).toBe(true);
  });

  it("resolves a branch to its full commit using the installation token", async () => {
    const { http, calls } = fakeGithub();
    const sha = await new GithubAppDispatcher({ appId: "1", privateKey }, http).resolveRef(repo, "main");
    expect(sha).toBe(SHA);
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://api.github.com", "")}`)).toEqual([
      "GET /repos/acme/weather/installation",
      "POST /app/installations/42/access_tokens",
      "GET /repos/acme/weather/commits/main",
    ]);
    expect(calls[0]!.auth).toMatch(/^Bearer ey/);
    expect(calls[2]!.auth).toBe("Bearer inst-token");
  });

  it("reuses the installation token between calls", async () => {
    const { http, calls } = fakeGithub();
    const dispatcher = new GithubAppDispatcher({ appId: "1", privateKey }, http);
    await dispatcher.resolveRef(repo, "main");
    await dispatcher.resolveRef(repo, "main");
    expect(calls.filter((c) => c.url.endsWith("/access_tokens"))).toHaveLength(1);
  });

  it("dispatches the workflow with the exact commit, the environment and the marker", async () => {
    const { http, calls } = fakeGithub();
    await new GithubAppDispatcher({ appId: "1", privateKey }, http).dispatch(repo, { ref: "main", sha: SHA, environment: "pro", marker: "deploy:abc" });
    expect(calls.at(-1)).toMatchObject({ method: "POST", body: { ref: "main", inputs: { sha: SHA, environment: "pro", deploy_id: "deploy:abc" } } });
  });

  it("says so when the App is not installed on the repository", async () => {
    const { http } = fakeGithub({ "GET /repos/acme/weather/installation": () => new Response("{}", { status: 404 }) });
    await expect(new GithubAppDispatcher({ appId: "1", privateKey }, http).resolveRef(repo, "main")).rejects.toBeInstanceOf(CiUnavailableError);
  });

  it("turns GitHub errors into upstream errors", async () => {
    const { http } = fakeGithub({ "GET /repos/acme/weather/commits/main": () => new Response("Not Found", { status: 404 }) });
    await expect(new GithubAppDispatcher({ appId: "1", privateKey }, http).resolveRef(repo, "main")).rejects.toBeInstanceOf(AssistantUpstreamError);
  });

  it("only supports GitHub for now, and unconfigured installations say how to fix it", async () => {
    const d = new GithubAppDispatcher({ appId: "1", privateKey }, fakeGithub().http);
    await expect(d.resolveRef({ ...repo, provider: "gitlab", url: "https://gitlab.com/a/b" }, "main")).rejects.toThrow(/only GitHub/);
    await expect(new UnconfiguredDispatcher().resolveRef()).rejects.toThrow(/GITHUB_APP_ID/);
  });
});

describe("GitHub webhook (ADR-064)", () => {
  const secret = "s3cret";
  const body = JSON.stringify({ workflow_run: { display_title: "Deploy deploy:abc", status: "completed", conclusion: "success", html_url: "https://github.com/acme/weather/actions/runs/1" } });
  const sign = (b: string, s = secret) => `sha256=${createHmac("sha256", s).update(b).digest("hex")}`;

  it("accepts only a body signed with the secret", () => {
    expect(verifyGithubSignature(secret, body, sign(body))).toBe(true);
    expect(verifyGithubSignature(secret, body, sign(body, "other"))).toBe(false);
    expect(verifyGithubSignature(secret, body + " ", sign(body))).toBe(false);
    expect(verifyGithubSignature(secret, body, null)).toBe(false);
    expect(verifyGithubSignature(secret, body, "sha256=zz")).toBe(false);
    expect(verifyGithubSignature("", body, sign(body, ""))).toBe(false);
  });

  it("reads the workflow run", () => {
    expect(parseWorkflowRunEvent(JSON.parse(body))).toEqual({ title: "Deploy deploy:abc", status: "completed", conclusion: "success", htmlUrl: "https://github.com/acme/weather/actions/runs/1" });
    expect(parseWorkflowRunEvent({ zen: "hi" })).toBeNull();
  });
});
