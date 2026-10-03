import { describe, expect, it } from "vitest";
import { configFromEnv as fromEnv } from "@/adapters/outbound/clickhouse/client";

const configFromEnv = (env: Record<string, string>) => fromEnv(env as NodeJS.ProcessEnv);

describe("configFromEnv write credentials (ADR-045)", () => {
  it("reuses the read credentials when no write user is configured", () => {
    const c = configFromEnv({ CLICKHOUSE_USER: "reader", CLICKHOUSE_PASSWORD: "pw" });
    expect([c.writeUsername, c.writePassword]).toEqual(["reader", "pw"]);
  });

  it("uses the dedicated write user and never falls back to the read password for it", () => {
    const c = configFromEnv({ CLICKHOUSE_USER: "reader", CLICKHOUSE_PASSWORD: "pw", CLICKHOUSE_WRITE_USER: "api_writer", CLICKHOUSE_WRITE_PASSWORD: "wpw" });
    expect([c.writeUsername, c.writePassword]).toEqual(["api_writer", "wpw"]);
    expect(configFromEnv({ CLICKHOUSE_PASSWORD: "pw", CLICKHOUSE_WRITE_USER: "api_writer" }).writePassword).toBe("");
  });
});
