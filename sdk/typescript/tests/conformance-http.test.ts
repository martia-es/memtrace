/** The `http/` scenarios of sdk/conformance/ (ADR-095), with `fetch` replaced by a recorder. See conformance.test.ts. */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { feedback, retractFeedback } from "../src/index.js";
import { MemTraceResultsSink } from "../src/eval/sink.js";
import { ExperimentResult } from "../src/eval/types.js";
import { HttpPromptClient } from "../src/prompts/httpSource.js";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "conformance", "http");

interface Scenario {
  description: string;
  env?: Record<string, string>;
  baseUrl: string;
  apiKey: string;
  call: Record<string, any>;
  respond: { status: number; json?: unknown; headers?: Record<string, string> };
  expect: {
    requests: Array<{
      method: string; path: string; query?: Record<string, string>; headers?: Record<string, string>;
      absentHeaders?: string[]; json?: unknown;
    }>;
    result?: unknown;
  };
}

const SUPPORTED = new Set(["feedback", "retractFeedback", "promptResolve", "evalRun"]);
const scenarios = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort()
  .map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(DIR, f), "utf8")) as Scenario] as const);

const savedEnv = { ...process.env };
afterEach(() => {
  for (const name of Object.keys(process.env)) if (!(name in savedEnv)) delete process.env[name];
  Object.assign(process.env, savedEnv);
});

describe("http scenarios", () => {
  expect(scenarios.length).toBeGreaterThan(0);
  for (const [id, scenario] of scenarios) {
    const test = SUPPORTED.has(scenario.call.op) ? it : it.skip;
    test(id, async () => {
      for (const name of Object.keys(process.env)) if (name.startsWith("MEMTRACE_")) delete process.env[name];
      Object.assign(process.env, scenario.env ?? {});
      const seen: Array<{ method: string; url: URL; headers: Headers; body: string | undefined }> = [];
      const fakeFetch = (async (input: URL, init: RequestInit) => {
        seen.push({ method: init.method as string, url: input, headers: new Headers(init.headers), body: init.body as string | undefined });
        const { status, json, headers } = scenario.respond;
        return new Response(json === undefined || status === 204 || status === 304 ? null : JSON.stringify(json), { status, headers });
      }) as unknown as typeof fetch;
      const http = { baseUrl: scenario.baseUrl, apiKey: scenario.apiKey, fetch: fakeFetch };
      const { call } = scenario;

      let result: unknown;
      if (call.op === "feedback") {
        await feedback(call.traceId, call.rating, { ...http, comment: call.comment, endUserId: call.endUserId, externalMessageId: call.externalMessageId });
      } else if (call.op === "retractFeedback") {
        await retractFeedback(call.traceId, { ...http, endUserId: call.endUserId });
      } else if (call.op === "evalRun") {
        const items = call.items.map((i: any) => ({
          item: { input: i.input, expectedOutput: i.expectedOutput }, output: i.output, traceId: i.traceId,
          scores: i.scores.map((s: any) => ({ name: s.name, value: s.value, dataType: s.dataType })),
        }));
        await new MemTraceResultsSink(call.datasetId, http).save(new ExperimentResult(call.runName, items, call.datasetVersion));
      } else {
        const fetched = await new HttpPromptClient(http).fetch(call.name, call.tag, call.version, call.etag ?? null);
        result = fetched && { version: fetched.version.version, content: fetched.version.content, variables: fetched.version.variables, etag: fetched.etag };
      }

      expect(seen).toHaveLength(scenario.expect.requests.length);
      scenario.expect.requests.forEach((want, i) => {
        const got = seen[i]!;
        expect(got.method).toBe(want.method);
        expect(got.url.pathname).toBe(want.path);
        for (const [key, value] of Object.entries(want.query ?? {})) expect(got.url.searchParams.get(key), `query ${key}`).toBe(value);
        for (const [key, value] of Object.entries(want.headers ?? {})) expect(got.headers.get(key), `header ${key}`).toBe(value);
        for (const key of want.absentHeaders ?? []) expect(got.headers.has(key)).toBe(false);
        if ("json" in want) expect(JSON.parse(got.body as string)).toEqual(want.json);
      });
      if ("result" in scenario.expect) expect(result).toEqual(scenario.expect.result);
    });
  }
});
