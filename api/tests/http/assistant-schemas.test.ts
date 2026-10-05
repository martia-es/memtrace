import { describe, expect, it } from "vitest";
import { createExperimentBody } from "@/adapters/inbound/http/identity-schemas";
import {
  addGrantBody,
  createDeploymentBody,
  declareConnectionBody,
  decideConnectionBody,
  updateDeploymentBody,
} from "@/adapters/inbound/http/assistant-schemas";

describe("assistant registry request bodies (ADR-053)", () => {
  it("creates an experiment, which is the agent's card, with only a name and a service name", () => {
    expect(createExperimentBody.parse({ name: "Weather", serviceName: "weather-assistant" })).toEqual({ name: "Weather", serviceName: "weather-assistant", description: "" });
    expect(createExperimentBody.parse({ name: "W", serviceName: "w", description: " Answers forecasts " })).toMatchObject({ description: "Answers forecasts" });
    expect(createExperimentBody.safeParse({ name: "W" }).success).toBe(false);
  });

  it("fills deployment defaults and keeps URLs for the domain to validate", () => {
    const body = createDeploymentBody.parse({ environmentKey: "pro", apiUrl: " https://api.acme.test/weather " });
    expect(body).toMatchObject({ apiUrl: "https://api.acme.test/weather", healthUrl: null, authMethod: "none", healthCheckEnabled: true, healthIntervalSeconds: null });
    expect(createDeploymentBody.safeParse({ apiUrl: "https://x" }).success).toBe(false);
    expect(createDeploymentBody.safeParse({ environmentKey: "pro", apiUrl: "https://x", authMethod: "password" }).success).toBe(false);
  });

  it("allows a partial deployment update and rejects unknown auth methods", () => {
    expect(updateDeploymentBody.parse({ version: "v1.2.0" })).toEqual({ version: "v1.2.0" });
    expect(updateDeploymentBody.safeParse({ authMethod: "basic" }).success).toBe(false);
  });

  it("accepts the three connection kinds and the three statuses only", () => {
    expect(declareConnectionBody.safeParse({ kind: "mcp_server", name: "weather-mcp" }).success).toBe(true);
    expect(declareConnectionBody.safeParse({ kind: "plugin", name: "x" }).success).toBe(false);
    expect(decideConnectionBody.parse({ status: "approved" })).toEqual({ status: "approved", note: null });
    expect(decideConnectionBody.safeParse({ status: "maybe" }).success).toBe(false);
  });

  it("requires a uuid for user grants", () => {
    expect(addGrantBody.safeParse({ subjectType: "everyone" }).success).toBe(true);
    expect(addGrantBody.safeParse({ subjectType: "user", userId: "not-a-uuid" }).success).toBe(false);
  });
});
