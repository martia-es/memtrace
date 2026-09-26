import { effectScope } from "vue";
import { describe, expect, it } from "vitest";
import { useAsync } from "@/ui/composables/useAsync";

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

describe("useAsync", () => {
  it("loads data and clears loading", async () => {
    const scope = effectScope();
    const a = scope.run(() => useAsync(async () => 42))!;
    await a.run();
    expect(a.data.value).toBe(42);
    expect(a.loading.value).toBe(false);
    scope.stop();
  });

  it("ignores a slow stale response when a newer load finished", async () => {
    const slow = deferred<string>();
    const fast = deferred<string>();
    const queue = [slow, fast];
    const scope = effectScope();
    const a = scope.run(() => useAsync(() => queue.shift()!.promise))!;
    const first = a.run();
    const second = a.run();
    fast.resolve("new");
    await second;
    slow.resolve("old");
    await first;
    expect(a.data.value).toBe("new");
    scope.stop();
  });

  it("aborts the previous request's signal and exposes errors", async () => {
    const signals: AbortSignal[] = [];
    const scope = effectScope();
    const a = scope.run(() =>
      useAsync(async (signal) => {
        signals.push(signal);
        if (signals.length === 2) throw new Error("boom");
        return "ok";
      }),
    )!;
    await a.run();
    await a.run();
    expect(signals[0]!.aborted).toBe(true);
    expect(a.error.value?.message).toBe("boom");
    scope.stop();
  });
});
