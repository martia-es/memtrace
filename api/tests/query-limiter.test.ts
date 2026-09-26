import { describe, expect, it } from "vitest";
import { QueryLimiter } from "@/adapters/outbound/clickhouse/query-limiter";

describe("QueryLimiter", () => {
  it("never runs more than maxConcurrent tasks at once and runs them all", async () => {
    const limiter = new QueryLimiter(2);
    let active = 0;
    let peak = 0;
    const task = async (n: number) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return n;
    };
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => limiter.run(() => task(i))));
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(2);
  });

  it("releases the slot when a task fails", async () => {
    const limiter = new QueryLimiter(1);
    await expect(limiter.run(async () => { throw new Error("x"); })).rejects.toThrow("x");
    await expect(limiter.run(async () => "ok")).resolves.toBe("ok");
  });

  it("rejects an invalid limit", () => {
    expect(() => new QueryLimiter(0)).toThrow();
  });
});
