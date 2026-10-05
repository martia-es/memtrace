import { describe, expect, it } from "vitest";
import type { AssistantCardDto, DeploymentSummaryDto, HealthCheckDto, HealthStatusDto } from "@contract";
import { personInitials, personLabel, accessSummary, authSummary, cardTone, featuredDeployment, connectionOrigin, errorRate, formatUptime, headline, healthBuckets, initials, isPendingReview, uptimePercent } from "@/domain/assistants";

const dep = (key: string, status: HealthStatusDto, isProduction = false, access = { everyone: false, groups: 0, users: 0 }): DeploymentSummaryDto =>
  ({
    id: key, experimentId: "e1", environmentId: key, apiUrl: "https://x", healthUrl: null, version: null, authMethod: "none", authProvider: null, authAudience: null,
    healthCheckEnabled: true, healthIntervalSeconds: null, healthStatus: status, healthCheckedAt: null, healthStatusSince: null, healthLatencyMs: null, healthConsecutiveFailures: 0,
    environment: { id: key, key, label: key.toUpperCase(), position: ({ dev: 0, pre: 1, pro: 2 } as Record<string, number>)[key] ?? 0, isProduction, healthIntervalSeconds: 60 }, access,
    recent: { buckets: [], uptimePercent: null },
  }) as DeploymentSummaryDto;
const card = (deployments: DeploymentSummaryDto[], lifecycle: "active" | "retired" = "active") => ({ deployments, lifecycle }) as Pick<AssistantCardDto, "deployments" | "lifecycle">;
const check = (checkedAt: string, status: HealthStatusDto): HealthCheckDto => ({ checkedAt, status, latencyMs: 10, httpStatus: 200, error: null });

describe("assistant presentation rules (ADR-053)", () => {
  it("headlines the worst environment", () => {
    expect(headline(card([]))).toEqual({ label: "Not deployed", tone: "neutral" });
    expect(headline(card([dep("dev", "up"), dep("pro", "down", true)]))).toEqual({ label: "Down in PRO", tone: "error" });
    expect(headline(card([dep("pre", "degraded"), dep("pro", "up", true)]))).toEqual({ label: "Degraded in PRE", tone: "warn" });
    expect(headline(card([dep("pro", "unknown", true)]))).toEqual({ label: "Check pending", tone: "neutral" });
    // solo en DEV y funcionando: verde, aunque no esté en producción
    expect(headline(card([dep("dev", "up")]))).toEqual({ label: "Healthy", tone: "ok" });
    expect(headline(card([dep("dev", "up"), dep("pro", "up", true)]))).toEqual({ label: "Healthy", tone: "ok" });
    expect(headline(card([dep("pro", "down", true)], "retired")).label).toBe("Retired");
  });

  it("turns the whole card grey when there is nothing deployed (or it is retired), and only then", () => {
    expect(cardTone(card([]))).toBe("off");
    expect(cardTone(card([dep("pro", "up", true)], "retired"))).toBe("off");
    expect(cardTone(card([dep("dev", "up")]))).toBe("ok");
    expect(cardTone(card([dep("dev", "unknown")]))).toBe("neutral");
    expect(cardTone(card([dep("dev", "up"), dep("pro", "down", true)]))).toBe("error");
    expect(cardTone(card([dep("pre", "degraded")]))).toBe("warn");
  });

  it("features production, or else the most advanced environment", () => {
    expect(featuredDeployment(card([dep("dev", "up"), dep("pro", "up", true)]))!.environment.key).toBe("pro");
    expect(featuredDeployment(card([dep("dev", "up"), dep("pre", "up")]))!.environment.key).toBe("pre");
    expect(featuredDeployment(card([]))).toBeNull();
  });

  it("summarizes who can call a deployment", () => {
    expect(accessSummary({ access: { everyone: true, groups: 3, users: 2 } })).toBe("Everyone in the organization");
    expect(accessSummary({ access: { everyone: false, groups: 2, users: 1 } })).toBe("2 groups · 1 user");
    expect(accessSummary({ access: { everyone: false, groups: 0, users: 0 } })).toBe("No access defined");
  });

  it("names the authentication method with its provider", () => {
    expect(authSummary({ authMethod: "oauth2", authProvider: "Entra ID" })).toBe("OAuth 2.0 · Entra ID");
    expect(authSummary({ authMethod: "none", authProvider: null })).toBe("No authentication");
  });

  it("buckets checks over time keeping the worst status of each bucket", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    const buckets = healthBuckets(
      [check("2026-10-05T11:50:00Z", "up"), check("2026-10-05T11:55:00Z", "down"), check("2026-10-05T10:10:00Z", "degraded"), check("2026-10-03T00:00:00Z", "down")],
      2, 4, now,
    );
    expect(buckets.map((b) => b.status)).toEqual(["degraded", null, null, "down"]);
  });

  it("computes uptime as the share of checks that were not down", () => {
    expect(uptimePercent([])).toBeNull();
    expect(uptimePercent([check("a", "up"), check("b", "degraded"), check("c", "down"), check("d", "up")])).toBe(75);
    expect(formatUptime(null)).toBe("–");
    expect(formatUptime(100)).toBe("100%");
    expect(formatUptime(99.2)).toBe("99.20%");
    expect(formatUptime(83.333)).toBe("83.3%");
  });

  it("tells where a connection comes from and when it needs review", () => {
    expect(connectionOrigin({ declared: true, firstSeenAt: "2026-10-01T00:00:00Z" })).toBe("declared-and-seen");
    expect(connectionOrigin({ declared: false, firstSeenAt: "2026-10-01T00:00:00Z" })).toBe("seen-only");
    expect(connectionOrigin({ declared: true, firstSeenAt: null })).toBe("declared-only");
    expect(isPendingReview({ firstSeenAt: "2026-10-01T00:00:00Z", status: "pending" })).toBe(true);
    expect(isPendingReview({ firstSeenAt: null, status: "pending" })).toBe(false);
    expect(isPendingReview({ firstSeenAt: "2026-10-01T00:00:00Z", status: "approved" })).toBe(false);
  });

  it("names a person by their name, or their email when the provider gave none", () => {
    expect(personLabel({ name: " Marta Fernández ", email: "m@acme.test" })).toBe("Marta Fernández");
    expect(personLabel({ name: null, email: "luis@acme.test" })).toBe("luis@acme.test");
    expect(personInitials({ name: "Marta Fernández", email: "m@acme.test" })).toBe("MF");
    expect(personInitials({ name: null, email: "luis.perez@acme.test" })).toBe("LU");
    expect(personInitials({ name: "  ", email: "ana-ruiz@acme.test" })).toBe("AR");
  });

  it("derives the error rate only when there were calls, and initials from names", () => {
    expect(errorRate(null)).toBeNull();
    expect(errorRate({ calls: 0, errors: 0 })).toBeNull();
    expect(errorRate({ calls: 200, errors: 5 })).toBe(0.025);
    expect(initials("weather-assistant")).toBe("WA");
    expect(initials("invoices")).toBe("IN");
  });
});
