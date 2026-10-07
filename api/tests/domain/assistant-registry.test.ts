import { describe, expect, it } from "vitest";
import { ValidationError } from "@/domain/errors";
import {
  applyProbe,
  commitUrl,
  detectRepoProvider,
  validateRepoConfig,
  isBlockedAddress,
  classifyProbe,
  validateDeclaredConnection,
  validateDeploymentPatch,
  validateNewGrant,
  DEFAULT_ENVIRONMENTS,
  effectiveIntervalSeconds,
  isDueForCheck,
  isProbeableUrl,
  isStaleDeclaration,
  needsReview,
  overallStatus,
  resolveHealthUrl,
} from "@/domain/assistant-registry";

const now = new Date("2026-10-05T12:00:00Z");

describe("assistant registry (ADR-053)", () => {
  it("seeds DEV, PRE and PRO with only PRO as production", () => {
    expect(DEFAULT_ENVIRONMENTS.map((e) => [e.key, e.isProduction])).toEqual([
      ["dev", false],
      ["pre", false],
      ["pro", true],
    ]);
  });

  it("derives the health URL from the API URL unless one is set", () => {
    expect(resolveHealthUrl({ apiUrl: "https://api.acme.test/weather/", healthUrl: null })).toBe("https://api.acme.test/weather/health");
    expect(resolveHealthUrl({ apiUrl: "https://api.acme.test", healthUrl: "https://api.acme.test/status" })).toBe("https://api.acme.test/status");
  });

  it("only probes plain http(s) URLs without credentials", () => {
    expect(isProbeableUrl("https://api.acme.test/health")).toBe(true);
    expect(isProbeableUrl("http://10.0.0.5:8080/health")).toBe(true);
    expect(isProbeableUrl("file:///etc/passwd")).toBe(false);
    expect(isProbeableUrl("gopher://x")).toBe(false);
    expect(isProbeableUrl("https://user:pass@api.acme.test")).toBe(false);
    expect(isProbeableUrl("not a url")).toBe(false);
  });

  it("reports the worst environment as the assistant status", () => {
    expect(overallStatus([])).toBeNull();
    expect(overallStatus([{ healthStatus: "up" }, { healthStatus: "up" }])).toBe("up");
    expect(overallStatus([{ healthStatus: "up" }, { healthStatus: "unknown" }])).toBe("unknown");
    expect(overallStatus([{ healthStatus: "degraded" }, { healthStatus: "unknown" }, { healthStatus: "up" }])).toBe("degraded");
    expect(overallStatus([{ healthStatus: "down" }, { healthStatus: "degraded" }])).toBe("down");
  });

  it("uses the deployment interval over the environment one, never below 15 s", () => {
    expect(effectiveIntervalSeconds({ healthIntervalSeconds: null }, { healthIntervalSeconds: 60 })).toBe(60);
    expect(effectiveIntervalSeconds({ healthIntervalSeconds: 120 }, { healthIntervalSeconds: 60 })).toBe(120);
    expect(effectiveIntervalSeconds({ healthIntervalSeconds: 5 }, { healthIntervalSeconds: 60 })).toBe(15);
  });

  it("is due when never checked or when the interval has passed", () => {
    const env = { healthIntervalSeconds: 60 };
    const base = { healthCheckEnabled: true, healthIntervalSeconds: null };
    expect(isDueForCheck({ ...base, healthCheckedAt: null }, env, now)).toBe(true);
    expect(isDueForCheck({ ...base, healthCheckedAt: "2026-10-05T11:59:30Z" }, env, now)).toBe(false);
    expect(isDueForCheck({ ...base, healthCheckedAt: "2026-10-05T11:58:59Z" }, env, now)).toBe(true);
    expect(isDueForCheck({ ...base, healthCheckEnabled: false, healthCheckedAt: null }, env, now)).toBe(false);
  });

  it("flags drift only for connections seen in traces and still pending", () => {
    expect(needsReview({ firstSeenAt: "2026-10-03T00:00:00Z", status: "pending" })).toBe(true);
    expect(needsReview({ firstSeenAt: "2026-10-03T00:00:00Z", status: "approved" })).toBe(false);
    expect(needsReview({ firstSeenAt: "2026-10-03T00:00:00Z", status: "blocked" })).toBe(false);
    expect(needsReview({ firstSeenAt: null, status: "pending" })).toBe(false);
  });

  it("marks a declaration stale when never seen or unseen for 30 days", () => {
    expect(isStaleDeclaration({ declared: true, lastSeenAt: null }, now)).toBe(true);
    expect(isStaleDeclaration({ declared: true, lastSeenAt: "2026-08-01T00:00:00Z" }, now)).toBe(true);
    expect(isStaleDeclaration({ declared: true, lastSeenAt: "2026-10-01T00:00:00Z" }, now)).toBe(false);
    expect(isStaleDeclaration({ declared: false, lastSeenAt: null }, now)).toBe(false);
  });

  it("classifies a probe: fast 2xx is up, slow 2xx degraded, anything else down", () => {
    expect(classifyProbe({ httpStatus: 200, latencyMs: 120, error: null })).toBe("up");
    expect(classifyProbe({ httpStatus: 204, latencyMs: 1500, error: null })).toBe("up");
    expect(classifyProbe({ httpStatus: 200, latencyMs: 1501, error: null })).toBe("degraded");
    expect(classifyProbe({ httpStatus: 503, latencyMs: 50, error: null })).toBe("down");
    expect(classifyProbe({ httpStatus: 401, latencyMs: 50, error: null })).toBe("down");
    expect(classifyProbe({ httpStatus: 301, latencyMs: 50, error: null })).toBe("down");
    expect(classifyProbe({ httpStatus: null, latencyMs: null, error: "timeout" })).toBe("down");
  });

  it("waits for two failures in a row before turning a healthy deployment down", () => {
    const t = (n: number) => `2026-10-05T12:0${n}:00Z`;
    const up = { status: "up" as const, statusSince: t(0), consecutiveFailures: 0 };
    const firstFailure = applyProbe(up, "down", t(1));
    expect(firstFailure).toEqual({ status: "up", statusSince: t(0), consecutiveFailures: 1 });
    const secondFailure = applyProbe(firstFailure, "down", t(2));
    expect(secondFailure).toEqual({ status: "down", statusSince: t(2), consecutiveFailures: 2 });
    expect(applyProbe(secondFailure, "down", t(3))).toEqual({ status: "down", statusSince: t(2), consecutiveFailures: 3 });
    expect(applyProbe(secondFailure, "up", t(4))).toEqual({ status: "up", statusSince: t(4), consecutiveFailures: 0 });
  });

  it("keeps an unknown deployment unknown after one failure, and starts the clock on the first result", () => {
    const unknown = { status: "unknown" as const, statusSince: null, consecutiveFailures: 0 };
    expect(applyProbe(unknown, "down", "2026-10-05T12:00:00Z").status).toBe("unknown");
    expect(applyProbe(unknown, "up", "2026-10-05T12:00:00Z")).toEqual({ status: "up", statusSince: "2026-10-05T12:00:00Z", consecutiveFailures: 0 });
  });

  it("rejects bad deployment fields with a message per field", () => {
    expect(() => validateDeploymentPatch({ apiUrl: "ftp://x", healthIntervalSeconds: 5 })).toThrow(/Invalid deployment/);
    try {
      validateDeploymentPatch({ apiUrl: "ftp://x", healthIntervalSeconds: 5 });
    } catch (e) {
      expect(Object.keys((e as { fields: object }).fields).sort()).toEqual(["apiUrl", "healthIntervalSeconds"]);
    }
    expect(() => validateDeploymentPatch({ healthUrl: null, healthIntervalSeconds: null })).not.toThrow();
  });

  it("requires exactly the identifiers each grant type needs", () => {
    expect(() => validateNewGrant({ subjectType: "user", userId: "u1" })).not.toThrow();
    expect(() => validateNewGrant({ subjectType: "group", externalGroup: "Support-Agents" })).not.toThrow();
    expect(() => validateNewGrant({ subjectType: "everyone" })).not.toThrow();
    expect(() => validateNewGrant({ subjectType: "user" })).toThrow();
    expect(() => validateNewGrant({ subjectType: "group", externalGroup: "  " })).toThrow();
    expect(() => validateNewGrant({ subjectType: "everyone", userId: "u1" })).toThrow();
  });

  it("only lets tools have a via and agents point to a peer", () => {
    expect(() => validateDeclaredConnection({ kind: "tool", name: "get_forecast", via: "weather-mcp" })).not.toThrow();
    expect(() => validateDeclaredConnection({ kind: "mcp_server", name: "weather-mcp", via: "x" })).toThrow();
    expect(() => validateDeclaredConnection({ kind: "tool", name: "t", peerExperimentId: "e1" })).toThrow();
    expect(() => validateDeclaredConnection({ kind: "agent", name: " " })).toThrow();
  });

  it("blocks every non-public address, in IPv4, IPv6 and IPv4-mapped form", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "169.254.169.254", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fd00::1", "fc12::1", "ff02::1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "[::1]", "not-an-ip"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "93.184.216.34", "172.15.0.1", "172.32.0.1", "100.63.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  it("lets private networks through on request but never the cloud metadata range", () => {
    const allow = { allowPrivateNetworks: true };
    for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.9", "::1", "fd00::1", "::ffff:10.0.0.1"]) expect(isBlockedAddress(ip, allow), ip).toBe(false);
    for (const ip of ["169.254.169.254", "169.254.0.1", "fe80::1", "::ffff:169.254.169.254", "not-an-ip"]) expect(isBlockedAddress(ip, allow), ip).toBe(true);
  });
});

describe("repositorio del agente (ADR-064)", () => {
  const repo = { url: "https://github.com/acme/weather", provider: "github" as const, deployWorkflow: "deploy.yml" };

  it("acepta un repo https cuyo host es el del proveedor", () => {
    expect(() => validateRepoConfig(repo)).not.toThrow();
    expect(() => validateRepoConfig({ url: "https://gitlab.acme.io/g/p", provider: "gitlab", deployWorkflow: null })).toThrow(ValidationError);
    expect(() => validateRepoConfig({ url: "https://git.gitlab.com/g/p", provider: "gitlab", deployWorkflow: null })).not.toThrow();
  });

  it.each([
    ["http://github.com/acme/weather"],
    ["https://user:token@github.com/acme/weather"],
    ["https://github.com/acme/weather?x=1"],
    ["https://evil.com/github.com/acme"],
    ["no-es-una-url"],
  ])("rechaza %s", (url) => {
    expect(() => validateRepoConfig({ ...repo, url })).toThrow(ValidationError);
  });

  it("rechaza un workflow con espacios", () => {
    expect(() => validateRepoConfig({ ...repo, deployWorkflow: "deploy now" })).toThrow(ValidationError);
  });

  it("detecta el proveedor por el host", () => {
    expect(detectRepoProvider("https://bitbucket.org/a/b")).toBe("bitbucket");
    expect(detectRepoProvider("https://example.com/a/b")).toBeNull();
  });

  it("enlaza un commit según el proveedor", () => {
    const sha = "a".repeat(40);
    expect(commitUrl(repo, sha)).toBe(`https://github.com/acme/weather/commit/${sha}`);
    expect(commitUrl({ url: "https://gitlab.com/a/b.git", provider: "gitlab" }, sha)).toBe(`https://gitlab.com/a/b/-/commit/${sha}`);
    expect(commitUrl({ url: "https://bitbucket.org/a/b/", provider: "bitbucket" }, sha)).toBe(`https://bitbucket.org/a/b/commits/${sha}`);
    expect(commitUrl(null, sha)).toBeNull();
  });

  it("valida la rama del despliegue", () => {
    expect(() => validateDeploymentPatch({ deployRef: "release/1.2" })).not.toThrow();
    expect(() => validateDeploymentPatch({ deployRef: "main; rm -rf" })).toThrow(ValidationError);
    expect(() => validateDeploymentPatch({ deployRef: null })).not.toThrow();
  });
});
