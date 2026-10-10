import { AsyncLocalStorage } from "node:async_hooks";
import { ROOT_CONTEXT, SpanStatusCode, trace, type Span, type Tracer } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BasicTracerProvider, BatchSpanProcessor, SimpleSpanProcessor, type SpanExporter, type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  llmAttributes, sanitize, stepInputAttributes, stepOutputAttributes, stepStartAttributes, type Attributes, type LlmCall,
} from "./attributes.js";
import { resolveRevision, settings } from "./config.js";
import { DEFAULT_SENSITIVE_KEYS, Redactor, type RedactHook } from "./redaction.js";
import { CapturePolicy } from "./serialization.js";
import { SanitizingSpanExporter } from "./sanitizingExporter.js";
import { sc, type StepType } from "./semconv.js";

const TRACER_NAME = "memtrace";
const DEFAULT_ENDPOINT = "http://localhost:4318";

interface Store {
  span?: Span;
  sessionId?: string;
}
const storage = new AsyncLocalStorage<Store>();

export interface InitOptions {
  serviceName?: string;
  endpoint?: string;
  headers?: Record<string, string>;
  /** Replaces the OTLP exporter (tests). */
  spanExporter?: SpanExporter;
  /** Hook for personal data with no recognizable shape; runs on every exported span after the built-in masking. */
  redact?: RedactHook;
}

interface Active {
  provider: BasicTracerProvider;
  tracer: Tracer;
  capture: CapturePolicy;
}
let active: Active | undefined;

/** Tags spans made by third-party instrumentation with the active `session()` id. */
class SessionSpanProcessor implements SpanProcessor {
  onStart(span: Span): void {
    const sessionId = storage.getStore()?.sessionId;
    // spans made through this SDK already resolve their own conversation id
    const scope = (span as unknown as { instrumentationScope?: { name: string } }).instrumentationScope;
    if (sessionId && scope?.name !== TRACER_NAME) span.setAttribute(sc.GEN_AI_CONVERSATION_ID, sessionId);
  }
  onEnd(): void {}
  forceFlush(): Promise<void> { return Promise.resolve(); }
  shutdown(): Promise<void> { return Promise.resolve(); }
}

function resourceAttributes(serviceName: string): Record<string, string> {
  const attrs: Record<string, string> = { "service.name": serviceName };
  if (settings.serviceVersion) attrs["service.version"] = settings.serviceVersion;
  const { sha, dirty } = resolveRevision();
  if (sha) {
    attrs["vcs.repository.ref.revision"] = sha;
    if (dirty !== undefined) attrs["memtrace.revision.dirty"] = dirty ? "true" : "false";
  }
  if (settings.environment) attrs["deployment.environment.name"] = settings.environment;
  return attrs;
}

function otlpExporter(endpoint: string | undefined, headers: Record<string, string> | undefined): SpanExporter {
  let url = (endpoint ?? settings.otlpEndpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, "");
  if (!url.endsWith("/v1/traces")) url += "/v1/traces";
  return new OTLPTraceExporter({ url, headers: { ...settings.otlpHeaders, ...headers }, timeoutMillis: settings.exportTimeoutMs });
}

/** Initializes MemTrace. Idempotent and never throws: a second call returns without changing anything. */
export function initTracer(options: InitOptions = {}): void {
  try {
    if (active || !settings.enabled) return;
    const keys = [...new Set([...settings.redactKeys, ...DEFAULT_SENSITIVE_KEYS])];
    const redactor = new Redactor(keys, options.redact);
    const sanitizing = new SanitizingSpanExporter(options.spanExporter ?? otlpExporter(options.endpoint, options.headers), redactor);
    const processor = options.spanExporter
      ? new SimpleSpanProcessor(sanitizing)
      : new BatchSpanProcessor(sanitizing, {
          maxQueueSize: settings.batchMaxQueueSize,
          scheduledDelayMillis: settings.batchScheduleDelayMs,
          maxExportBatchSize: settings.batchMaxExportSize,
          exportTimeoutMillis: settings.exportTimeoutMs,
        });
    const provider = new BasicTracerProvider({
      resource: resourceFromAttributes(resourceAttributes(options.serviceName ?? settings.serviceName)),
      spanProcessors: [new SessionSpanProcessor(), processor],
    });
    active = {
      provider,
      tracer: provider.getTracer(TRACER_NAME),
      capture: new CapturePolicy(settings.captureContent, settings.maxContentLength, keys),
    };
  } catch (error) {
    console.warn("[MemTrace] Could not initialize tracing:", error);
  }
}

/** Sends what is pending and keeps tracing. */
export async function flush(): Promise<void> {
  try { await active?.provider.forceFlush(); } catch { /* never throws */ }
}

/** Flushes and stops tracing; `initTracer` can be called again afterwards. */
export async function shutdown(): Promise<void> {
  const current = active;
  active = undefined;
  try { await current?.provider.shutdown(); } catch { /* never throws */ }
}

/** Groups the spans created in `fn` under one conversation (`gen_ai.conversation.id`). */
export function session<T>(sessionId: string, fn: () => T): T {
  return storage.run({ ...storage.getStore(), sessionId }, fn);
}

export function currentSessionId(): string | undefined {
  return storage.getStore()?.sessionId;
}

/** Trace id of the span being executed, to hand to the caller together with the answer. */
export function currentTraceId(): string | undefined {
  const span = storage.getStore()?.span;
  const id = span?.spanContext();
  return id && span?.isRecording() ? id.traceId : undefined;
}

/** What a step callback receives: a way to add attributes to its own span. */
export interface Step {
  setAttributes(attributes: Attributes): void;
}

function setAttributes(span: Span, attributes: Attributes): void {
  try { span.setAttributes(sanitize(attributes)); } catch { /* never throws */ }
}

function endSpan(span: Span, error?: unknown): void {
  try {
    if (error === undefined) {
      span.setStatus({ code: SpanStatusCode.OK });
    } else {
      const err = error instanceof Error ? error : new Error(String(error));
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message || err.name });
    }
  } finally {
    span.end();
  }
}

/**
 * Runs `fn` inside a step. Spans created inside it (here or in any async continuation) hang from it.
 * The callback's result (or its rejection) is returned unchanged.
 */
export function withStep<T>(name: string, stepType: StepType, fn: (step: Step) => T, attributes?: Attributes): T {
  const current = active;
  if (!current) return fn({ setAttributes: () => {} });
  let span: Span;
  const store = storage.getStore();
  try {
    const parent = store?.span ? trace.setSpan(ROOT_CONTEXT, store.span) : ROOT_CONTEXT;
    span = current.tracer.startSpan(name, {}, parent);
    setAttributes(span, { ...stepStartAttributes(stepType, store?.sessionId), ...attributes });
  } catch {
    return fn({ setAttributes: () => {} });
  }
  const opened = span;
  const step: Step = { setAttributes: (attrs) => setAttributes(opened, attrs) };
  let result: T;
  try {
    result = storage.run({ ...store, span: opened }, () => fn(step));
  } catch (error) {
    endSpan(opened, error);
    throw error;
  }
  if (result instanceof Promise) {
    return result.then(
      (value) => { endSpan(opened); return value; },
      (error) => { endSpan(opened, error); throw error; },
    ) as T;
  }
  endSpan(opened);
  return result;
}

/**
 * Wraps a function so each call is a step; with `MEMTRACE_CAPTURE_CONTENT=true` it records its arguments and result.
 */
export function traceStep<A extends unknown[], R>(
  fn: (...args: A) => R, options: { name?: string; stepType?: StepType } = {},
): (...args: A) => R {
  const name = options.name ?? (fn.name || "step");
  const stepType = options.stepType ?? "chain";
  return (...args: A): R =>
    withStep(name, stepType, (step) => {
      const capture = active?.capture;
      if (capture?.enabled) step.setAttributes(stepInputAttributes(stepType, name, capture.apply(args)));
      const result = fn(...args);
      if (result instanceof Promise) {
        return result.then((value) => {
          if (capture?.enabled) step.setAttributes(stepOutputAttributes(stepType, capture.apply(value)));
          return value;
        }) as R;
      }
      if (capture?.enabled) step.setAttributes(stepOutputAttributes(stepType, capture.apply(result)));
      return result;
    });
}

export interface LlmCallOptions extends Omit<LlmCall, "provider" | "model"> {
  inputMessages?: unknown[];
  outputMessages?: unknown[];
  attributes?: Attributes;
}

/** Records the standardized GenAI attributes on the current step. Never throws. */
export function traceLlmCall(provider: string, model: string, options: LlmCallOptions = {}): void {
  try {
    const current = active;
    const span = storage.getStore()?.span;
    if (!current || !span) return;
    const { inputMessages, outputMessages, attributes, ...call } = options;
    setAttributes(span, {
      ...llmAttributes({ ...call, provider, model }, current.capture.apply(inputMessages), current.capture.apply(outputMessages)),
      ...attributes,
    });
  } catch { /* never throws */ }
}
