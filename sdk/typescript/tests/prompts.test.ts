import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MissingVariableError, PromptNotFoundError, render, PromptSourceError, PromptUnavailableError, extractVariables, localDefault,
  type Fetched, type PromptSource, type PromptVersion, type UsedPrompt,
} from "../src/prompts/domain.js";
import { FilePromptCache } from "../src/prompts/fileCache.js";
import { PromptRegistry } from "../src/prompts/registry.js";

const version = (n: number, content = `Hola {{ciudad}} v${n}`): PromptVersion =>
  ({ name: "weather", version: n, content, variables: extractVariables(content), contentHash: `h${n}`, archived: false, draft: false });

class FakeSource implements PromptSource {
  current = 1;
  down = false;
  missing = false;
  calls: Array<{ tag?: string; version?: number; etag: string | null }> = [];
  overrides = new Map<string, PromptVersion>();
  async fetch(_name: string, tag: string | undefined, v: number | undefined, etag: string | null): Promise<Fetched | null> {
    this.calls.push({ tag, version: v, etag });
    if (this.down) throw new PromptSourceError("connection refused");
    if (this.missing) throw new PromptNotFoundError("Tag \"pro\" of \"weather\" not found");
    const tagetag = `"v${v ?? this.current}"`;
    if (etag === tagetag) return null;
    return { version: version(v ?? this.current), etag: tagetag };
  }
  async fetchOverride(_name: string, token: string) { return this.overrides.get(token) ?? null; }
}

let now = 0;
const clock = () => now;
const make = (source: FakeSource | undefined, extra: Record<string, unknown> = {}) =>
  new PromptRegistry(source, { clock, environment: "PRO", refreshSeconds: 30, log: () => {}, ...extra });
afterEach(() => { now = 0; });

describe("domain", () => {
  it("extracts variables once, in order, tolerating spaces", () => expect(extractVariables("{{a}} {{ b }} {{a}}")).toEqual(["a", "b"]));
  it("renders values as text and does not expand them again", () => {
    const v = localDefault("p", "Hi {{x}} and {{y}}");
    expect(render(v, { x: "{{y}}", y: 7, extra: 1 })).toBe("Hi {{y}} and 7");
    expect(() => render(v, { x: 1 })).toThrow("needs the variable(s): y");
  });
});

describe("registry", () => {
  it("follows the tag named like the environment and compiles without network", async () => {
    const source = new FakeSource();
    const handle = await make(source).get("weather");
    expect(handle.tag).toBe("pro");
    expect(handle.compile({ ciudad: "Sevilla" })).toBe("Hola Sevilla v1");
    expect(source.calls).toHaveLength(1);
  });

  it("rejects both tag and version, and a version below 1", async () => {
    await expect(make(new FakeSource()).get("weather", { tag: "pro", version: 1 })).rejects.toThrow("not both");
    await expect(make(new FakeSource()).get("weather", { version: 0 })).rejects.toThrow("1 or greater");
  });

  it("needs a tag or an environment", async () => {
    await expect(new PromptRegistry(new FakeSource(), { log: () => {} }).get("weather")).rejects.toThrow("MEMTRACE_ENVIRONMENT");
  });

  it("a missing variable is an error that names it", async () => {
    const handle = await make(new FakeSource()).get("weather");
    expect(() => handle.compile({})).toThrow(MissingVariableError);
  });

  it("switches version when the tag moves, with an unchanged tag costing a 304", async () => {
    const source = new FakeSource();
    const registry = make(source);
    const handle = await registry.get("weather");
    now = 31; await registry.runOnce();
    expect(handle.version).toBe(1);
    expect(source.calls.at(-1)?.etag).toBe('"v1"');
    source.current = 2;
    now = 62; await registry.runOnce();
    expect(handle.compile({ ciudad: "X" })).toBe("Hola X v2");
  });

  it("keeps serving the last version while MemTrace is down and backs off", async () => {
    const source = new FakeSource();
    const registry = make(source);
    const handle = await registry.get("weather");
    source.down = true;
    now = 31; await registry.runOnce();
    const calls = source.calls.length;
    now = 32; await registry.runOnce(); // backing off: no new call
    expect(source.calls.length).toBe(calls);
    expect(handle.version).toBe(1);
  });

  it("a prompt that does not exist always fails at startup", async () => {
    const source = new FakeSource(); source.missing = true;
    await expect(make(source).get("weather")).rejects.toThrow(PromptNotFoundError);
  });

  it("a pinned version is fetched once and never followed", async () => {
    const source = new FakeSource();
    const registry = make(source);
    await registry.get("weather", { version: 3 });
    now = 100; await registry.runOnce();
    expect(source.calls).toHaveLength(1);
  });

  describe("when MemTrace is unreachable at startup", () => {
    it("uses the local default, version 0, and leaves it as soon as MemTrace answers", async () => {
      const source = new FakeSource(); source.down = true;
      const registry = make(source);
      const handle = await registry.get("weather", { default: "Hola {{ciudad}} local" });
      expect(handle.version).toBe(0);
      source.down = false;
      now = 6; await registry.runOnce(); // retried within 5 s
      expect(handle.version).toBe(1);
    });

    it("throws PromptUnavailableError without default or cache", async () => {
      const source = new FakeSource(); source.down = true;
      await expect(make(source).get("weather")).rejects.toThrow(PromptUnavailableError);
    });

    it("uses the disk cache the Python SDK also writes", async () => {
      const dir = mkdtempSync(join(tmpdir(), "memtrace-prompts-"));
      try {
        const cache = new FilePromptCache(dir);
        const source = new FakeSource();
        await make(source, { cache }).get("weather");
        source.down = true;
        const handle = await make(source, { cache }).get("weather");
        expect(handle.version).toBe(1);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  });

  it("without MEMTRACE_API_URL it works offline with the default", async () => {
    const handle = await make(undefined).get("weather", { default: "Hi {{x}}" });
    expect(handle.compile({ x: "there" })).toBe("Hi there");
  });

  it("stamps the prompt on the current step, but never the local default", async () => {
    const stamps: Array<Record<string, unknown>> = [];
    const handle = await make(new FakeSource(), { annotate: (a: Record<string, unknown>) => stamps.push(a) }).get("weather");
    handle.compile({ ciudad: "X" });
    expect(stamps).toEqual([{ "memtrace.prompt.name": "weather", "memtrace.prompt.version": 1 }]);
    const offline = await make(undefined, { annotate: (a: Record<string, unknown>) => stamps.push(a) }).get("weather", { default: "x" });
    offline.compile();
    expect(stamps).toHaveLength(1);
  });

  it("tells MemTrace which versions are in use, soon after a tag moves", async () => {
    const reports: UsedPrompt[][] = [];
    const usage = { report: async (_env: string | undefined, items: UsedPrompt[]) => { reports.push(items); } };
    const source = new FakeSource();
    const registry = make(source, { usage, usageSeconds: 300 });
    await registry.get("weather");
    await registry.runOnce();
    expect(reports).toEqual([[{ name: "weather", tag: "pro", version: 1 }]]);
    source.current = 2;
    now = 31; await registry.runOnce();
    expect(reports.at(-1)).toEqual([{ name: "weather", tag: "pro", version: 2 }]);
  });

  describe("playground override (ADR-071)", async () => {
    const { withPromptOverride } = await import("../src/prompts/registry.js");
    const token = "mto_abcdefghij1234";

    it("serves the granted version only inside the request that carries the token", async () => {
      const source = new FakeSource(); source.overrides.set(token, version(9, "Pruebas {{ciudad}}"));
      const stamps: Array<Record<string, unknown>> = [];
      const registry = make(source, { allowOverride: true, annotate: (a: Record<string, unknown>) => stamps.push(a) });
      const handle = await registry.get("weather");
      await registry.prefetchOverride(token);
      expect(withPromptOverride(token, () => handle.compile({ ciudad: "X" }))).toBe("Pruebas X");
      expect(stamps.at(-1)).toMatchObject({ "memtrace.prompt.version": 9, "memtrace.playground": true });
      expect(handle.compile({ ciudad: "X" })).toBe("Hola X v1");
    });

    it("changes nothing without opt-in, with an unknown token or with a malformed one", async () => {
      const source = new FakeSource(); source.overrides.set(token, version(9));
      const off = await make(source).get("weather");
      expect(withPromptOverride(token, () => off.version)).toBe(1);
      const registry = make(source, { allowOverride: true });
      const handle = await registry.get("weather");
      await registry.prefetchOverride("mto_unknownunknown1");
      await registry.prefetchOverride("bad");
      expect(withPromptOverride("mto_unknownunknown1", () => handle.compile({ ciudad: "X" }))).toBe("Hola X v1");
    });
  });
});
