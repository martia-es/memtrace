import { describe, expect, it } from "vitest";
import { RateLimiter } from "@/application/rate-limiter";

describe("RateLimiter (ADR-092)", () => {
  it("allows up to the limit in a window and then refuses with a Retry-After", () => {
    let clock = 0;
    const limiter = new RateLimiter(3, 60_000, () => clock);
    expect([1, 2, 3].map(() => limiter.hit("k").allowed)).toEqual([true, true, true]);
    clock = 10_000;
    const refused = limiter.hit("k");
    expect(refused).toMatchObject({ allowed: false, remaining: 0, retryAfterSeconds: 50 });
  });

  it("opens a new window when the previous one ends", () => {
    let clock = 0;
    const limiter = new RateLimiter(1, 1000, () => clock);
    limiter.hit("k");
    expect(limiter.hit("k").allowed).toBe(false);
    clock = 1000;
    expect(limiter.hit("k").allowed).toBe(true);
  });

  it("counts every key on its own", () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.hit("a").allowed).toBe(true);
    expect(limiter.hit("b").allowed).toBe(true);
    expect(limiter.hit("a").allowed).toBe(false);
  });

  it("peek does not count", () => {
    const limiter = new RateLimiter(1, 1000);
    for (let i = 0; i < 5; i++) expect(limiter.peek("k").allowed).toBe(true);
    expect(limiter.hit("k").allowed).toBe(true);
    expect(limiter.peek("k").allowed).toBe(true); // 1 de 1 todavía cabe; la siguiente no
    expect(limiter.hit("k").allowed).toBe(false);
  });

  it("does not grow without bound when attacked with endless distinct keys", () => {
    const limiter = new RateLimiter(5, 60_000, () => 0, 100);
    for (let i = 0; i < 10_000; i++) limiter.hit(`ip-${i}`);
    expect((limiter as unknown as { windows: Map<string, unknown> }).windows.size).toBeLessThanOrEqual(100);
  });

  it("rejects nonsensical settings", () => {
    expect(() => new RateLimiter(0, 1000)).toThrow();
    expect(() => new RateLimiter(5, 0)).toThrow();
  });
});
