/**
 * Runs the language-neutral scenarios in sdk/conformance/ against this SDK (ADR-095). The Python SDK runs the same
 * files (sdk/python/tests/test_conformance.py); the format is documented in sdk/conformance/README.md.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { InMemorySpanExporter, type ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { afterEach, describe, expect, it } from "vitest";
import { flush, initTracer, session, shutdown, user, traceLlmCall, withStep } from "../src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "conformance");

interface Action {
  op: string;
  id?: string;
  name?: string;
  type?: string;
  fail?: string;
  actions?: Action[];
  [key: string]: unknown;
}
interface SpanExpectation {
  name: string;
  parent?: string | null;
  attributes?: Record<string, unknown>;
  attributesJson?: Record<string, unknown>;
  absent?: string[];
  status?: "ok" | "error";
}
interface TracingScenario {
  description: string;
  env?: Record<string, string>;
  init: { serviceName: string };
  actions: Action[];
  expect: { resource?: Record<string, unknown>; spans?: SpanExpectation[] };
}

class ScenarioFailure extends Error {}

function load<T>(kind: string): Array<[string, T]> {
  const dir = join(ROOT, kind);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  expect(files.length).toBeGreaterThan(0);
  return files.map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(dir, f), "utf8")) as T]);
}

function hasFail(action: Action): boolean {
  return "fail" in action || (action.actions ?? []).some(hasFail);
}

function run(actions: Action[]): void {
  for (const action of actions) {
    if (action.op === "session") {
      session(action.id as string, () => run(action.actions ?? []));
    } else if (action.op === "user") {
      user(action.id as string, () => run(action.actions ?? []));
    } else if (action.op === "step") {
      withStep(action.name as string, action.type ?? "chain", () => {
        run(action.actions ?? []);
        if (action.fail !== undefined) throw new ScenarioFailure(action.fail);
      });
    } else if (action.op === "llm") {
      traceLlmCall(action.provider as string, action.model as string, {
        inputMessages: action.inputMessages as unknown[] | undefined,
        outputMessages: action.outputMessages as unknown[] | undefined,
        inputTokens: action.inputTokens as number | undefined,
        outputTokens: action.outputTokens as number | undefined,
        responseModel: action.responseModel as string | undefined,
        finishReasons: action.finishReasons as string[] | undefined,
        temperature: action.temperature as number | undefined,
      });
    } else {
      throw new Error(`unknown op ${action.op}`);
    }
  }
}

const savedEnv = { ...process.env };
afterEach(async () => {
  await shutdown();
  for (const name of Object.keys(process.env)) if (!(name in savedEnv)) delete process.env[name];
  Object.assign(process.env, savedEnv);
});

describe("tracing scenarios", () => {
  it.each(load<TracingScenario>("tracing"))("%s", async (_id, scenario) => {
    for (const name of Object.keys(process.env)) {
      if (name.startsWith("MEMTRACE_") || name === "GITHUB_SHA" || name === "GIT_SHA") delete process.env[name];
    }
    Object.assign(process.env, scenario.env ?? {});
    const exporter = new InMemorySpanExporter();
    initTracer({ serviceName: scenario.init.serviceName, spanExporter: exporter });

    if (scenario.actions.some(hasFail)) expect(() => run(scenario.actions)).toThrow(ScenarioFailure);
    else run(scenario.actions);
    await flush(); // spans are sanitized asynchronously before they reach the exporter

    const spans = new Map<string, ReadableSpan>();
    for (const span of exporter.getFinishedSpans()) if (span.instrumentationScope.name === "memtrace") spans.set(span.name, span);
    const namesById = new Map([...spans.values()].map((s) => [s.spanContext().spanId, s.name]));

    if (scenario.expect.resource) {
      const resource = [...spans.values()][0]!.resource.attributes;
      for (const [key, value] of Object.entries(scenario.expect.resource)) expect(resource[key], `resource ${key}`).toEqual(value);
    }
    for (const want of scenario.expect.spans ?? []) {
      const span = spans.get(want.name);
      expect(span, `span ${want.name}`).toBeDefined();
      if ("parent" in want) {
        const parentId = span!.parentSpanContext?.spanId;
        expect(parentId ? namesById.get(parentId) : null, `parent of ${want.name}`).toEqual(want.parent);
      }
      for (const [key, value] of Object.entries(want.attributes ?? {})) expect(span!.attributes[key], `${want.name}: ${key}`).toEqual(value);
      for (const [key, value] of Object.entries(want.attributesJson ?? {})) {
        expect(JSON.parse(span!.attributes[key] as string), `${want.name}: ${key}`).toEqual(value);
      }
      for (const key of want.absent ?? []) expect(span!.attributes, `${want.name} must not have ${key}`).not.toHaveProperty(key);
      if (want.status) expect(["UNSET", "OK", "ERROR"][span!.status.code], `status of ${want.name}`).toBe(want.status.toUpperCase());
    }
  });
});
