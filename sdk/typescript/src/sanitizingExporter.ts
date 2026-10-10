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
    this.inner.export(spans.map((span) => this.sanitize(span)), resultCallback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }

  private sanitize(span: ReadableSpan): ReadableSpan {
    try {
      const attributes = Object.fromEntries(
        Object.entries(span.attributes).map(([key, value]) => [key, this.redactor.attribute(key, value)]),
      );
      const events = span.events.map((event) => ({
        ...event,
        attributes: Object.fromEntries(
          Object.entries(event.attributes ?? {}).map(([key, value]) => [key, this.redactor.attribute(key, value)]),
        ),
      }));
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
