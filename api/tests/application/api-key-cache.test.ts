import { describe, expect, it, vi } from "vitest";
import { CachedApiKeyResolver, type ApiKeyAccess } from "@/application/api-key-cache";

const ACCESS: ApiKeyAccess = { experimentId: "exp-1", serviceName: "agent", createdByUserId: "u1" };

function setup(source: (key: string) => Promise<ApiKeyAccess | null>, overrides: Partial<ConstructorParameters<typeof CachedApiKeyResolver>[1]> = {}) {
  let at = 0;
  const fn = vi.fn(source);
  const cache = new CachedApiKeyResolver(fn, { ttlMs: 30_000, staleMs: 600_000, maxEntries: 100, failureBackoffMs: 5_000, now: () => at, ...overrides });
  return { cache, fn, advance: (ms: number) => (at += ms) };
}

describe("CachedApiKeyResolver (ADR-098)", () => {
  it("asks the source once while the entry is fresh", async () => {
    const { cache, fn, advance } = setup(async () => ACCESS);
    await cache.resolve("k");
    advance(29_000);
    expect(await cache.resolve("k")).toEqual(ACCESS);
    expect(fn).toHaveBeenCalledTimes(1);
    advance(2_000); // pasado el TTL
    await cache.resolve("k");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("never remembers an unknown or revoked key, and forgets one that was revoked", async () => {
    let revoked = false;
    const { cache, fn, advance } = setup(async () => (revoked ? null : ACCESS));
    expect(await cache.resolve("k")).toEqual(ACCESS);
    revoked = true;
    expect(await cache.resolve("k")).toEqual(ACCESS); // dentro del TTL: el retraso conocido de la revocación
    advance(31_000);
    expect(await cache.resolve("k")).toBeNull(); // pasado el TTL, la revocación se ve
    revoked = false;
    expect(await cache.resolve("k")).toEqual(ACCESS);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("keeps accepting a recently validated key while the source is down", async () => {
    let down = false;
    const { cache, advance } = setup(async () => {
      if (down) throw new Error("postgres down");
      return ACCESS;
    });
    await cache.resolve("k");
    down = true;
    advance(60_000); // caducada pero dentro de la ventana de tolerancia
    expect(await cache.resolve("k")).toEqual(ACCESS);
  });

  it("stops accepting a key once the stale bound has passed", async () => {
    let down = false;
    const { cache, advance } = setup(async () => {
      if (down) throw new Error("postgres down");
      return ACCESS;
    });
    await cache.resolve("k");
    down = true;
    advance(601_000);
    await expect(cache.resolve("k")).rejects.toThrow("postgres down");
  });

  it("rejects a key it has never seen while the source is down", async () => {
    const { cache } = setup(async () => {
      throw new Error("postgres down");
    });
    await expect(cache.resolve("never-seen")).rejects.toThrow("postgres down");
  });

  it("does not retry the source on every request right after it failed", async () => {
    let down = true;
    const { cache, fn, advance } = setup(async () => {
      if (down) throw new Error("postgres down");
      return ACCESS;
    });
    await expect(cache.resolve("a")).rejects.toThrow();
    await expect(cache.resolve("b")).rejects.toThrow();
    await expect(cache.resolve("c")).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1); // las otras dos se rechazan sin esperar al tiempo de espera
    down = false;
    advance(6_000); // acaba el período de espera
    expect(await cache.resolve("a")).toEqual(ACCESS);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("shares one query between concurrent requests for the same key", async () => {
    let release!: (access: ApiKeyAccess) => void;
    const { cache, fn } = setup(() => new Promise((resolve) => (release = resolve)));
    const all = Promise.all([cache.resolve("k"), cache.resolve("k"), cache.resolve("k")]);
    release(ACCESS);
    expect(await all).toEqual([ACCESS, ACCESS, ACCESS]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("is bounded: the oldest key is forgotten when it is full", async () => {
    const { cache, fn } = setup(async (key) => ({ ...ACCESS, experimentId: key }), { maxEntries: 2 });
    await cache.resolve("a");
    await cache.resolve("b");
    await cache.resolve("c"); // expulsa «a»
    await cache.resolve("b");
    await cache.resolve("c");
    expect(fn).toHaveBeenCalledTimes(3);
    await cache.resolve("a");
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("validates its options", () => {
    const source = async () => null;
    expect(() => new CachedApiKeyResolver(source, { ttlMs: 10, staleMs: 5, maxEntries: 1 })).toThrow();
    expect(() => new CachedApiKeyResolver(source, { ttlMs: 1, staleMs: 5, maxEntries: 0 })).toThrow();
  });

  it("reports what it did, so the service can measure it", async () => {
    const events: string[] = [];
    let down = false;
    const { cache, advance } = setup(async () => {
      if (down) throw new Error("postgres down");
      return ACCESS;
    }, { onEvent: (e) => events.push(e) });
    await cache.resolve("k"); // miss
    await cache.resolve("k"); // hit
    advance(31_000);
    down = true;
    await cache.resolve("k"); // stale: la fuente falla y se acepta lo recordado
    await expect(cache.resolve("never")).rejects.toThrow(); // failure
    expect(events).toEqual(["miss", "hit", "stale", "failure"]);
  });

  it("exposes how many keys it remembers and whether the source answers", async () => {
    let down = false;
    const { cache, advance } = setup(async () => {
      if (down) throw new Error("postgres down");
      return ACCESS;
    });
    expect(cache.size).toBe(0);
    await cache.resolve("a");
    expect(cache.size).toBe(1);
    expect(cache.sourceHealthy).toBe(true);
    down = true;
    advance(31_000);
    await cache.resolve("a");
    expect(cache.sourceHealthy).toBe(false);
    down = false;
    advance(6_000);
    await cache.resolve("a");
    expect(cache.sourceHealthy).toBe(true);
  });
});
