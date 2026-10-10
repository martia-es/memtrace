import type { ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { sc } from "./semconv.js";
import type { Redactor } from "./redaction.js";

/**
 * Last stop before a span leaves the process (ADR-021): wraps the real exporter and redacts secrets in attributes, event
 * attributes (exceptions included) and the status message. If sanitizing a span fails, it is exported without attributes
 * or events rather than raw.
 */
export class SanitizingSpanExporter implements SpanExporter {
  constructor(private readonly inner: SpanExporter, private readonly redactor: Redactor) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    Promise.all(spans.map((span) => this.sanitize(span))).then(
      (sanitized) => this.inner.export(sanitized, resultCallback),
      () => resultCallback({ code: 1 }), // ExportResultCode.FAILED; sanitize() itself never rejects
    );
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }

  private async redactAll(attrs: Record<string, unknown> | undefined): Promise<Record<string, unknown>> {
    const entries = await Promise.all(Object.entries(attrs ?? {}).map(async ([key, value]) => [key, await this.redactor.attribute(key, value)] as const));
    return Object.fromEntries(entries);
  }

  private async sanitize(span: ReadableSpan): Promise<ReadableSpan> {
    try {
      const attributes = await this.redactAll(span.attributes);
      const events = await Promise.all(span.events.map(async (event) => ({ ...event, attributes: await this.redactAll(event.attributes) })));
      const status = span.status.message ? { ...span.status, message: this.redactor.scrubText(span.status.message) } : span.status;
      return this.copy(span, attributes, events, status);
    } catch {
      return this.copy(span, { [sc.MEMTRACE_REDACTION_FAILED]: true }, [], { code: span.status.code });
    }
  }

  // The span keeps its prototype (spanContext(), resource...); only the sensitive fields are replaced.
  private copy(span: ReadableSpan, attributes: unknown, events: unknown, status: unknown): ReadableSpan {
    return Object.create(span, {
      attributes: { value: attributes, enumerable: true },
      events: { value: events, enumerable: true },
      status: { value: status, enumerable: true },
    }) as ReadableSpan;
  }
}
