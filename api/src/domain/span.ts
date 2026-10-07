export type StatusCode = "ok" | "error" | "unset";

export interface SpanStatus {
  code: StatusCode;
  message: string | null;
}

export interface SpanEvent {
  name: string;
  timeUs: number;
  attributes: Record<string, string>;
}

/** Span plano tal y como lo entrega el repositorio. Tiempos en microsegundos desde epoch. */
export interface Span {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  serviceName: string;
  /** scope de instrumentación OTel: identifica frameworks con autoinstrumentación nativa (ADR-011) */
  scopeName: string;
  startTimeUs: number;
  durationMs: number;
  status: SpanStatus;
  attributes: Record<string, string>;
  events: SpanEvent[];
  /** commit del código que generó el span (`vcs.repository.ref.revision`, ADR-065); ausente o null = versión desconocida */
  revision?: string | null;
}

export interface GenAiInfo {
  operation: string | null;
  provider: string | null;
  requestModel: string | null;
  responseModel: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  finishReasons: string[];
  temperature: number | null;
  maxTokens: number | null;
  toolName: string | null;
  toolCallId: string | null;
}

/** Contenido capturado (opt-in en el SDK, ADR-004). JSON parseado, o el string original si no es JSON. */
export interface SpanContent {
  inputMessages?: unknown;
  outputMessages?: unknown;
  toolArguments?: unknown;
  toolResult?: unknown;
  input?: unknown;
  output?: unknown;
}

export interface SpanNode {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: string;
  serviceName: string;
  startTimeUs: number;
  offsetMs: number;
  durationMs: number;
  status: SpanStatus;
  /** true si el padre referenciado no está presente (perdido o aún no exportado) */
  orphan: boolean;
  genAi: GenAiInfo | null;
  /** null si el span no es una llamada a un LLM, o no hay precio conocido para su modelo (ADR-025) */
  costUsd: number | null;
  content: SpanContent | null;
  /** framework de agentes que originó el span, si se pudo detectar (ADR-011) */
  framework: string | null;
  attributes: Record<string, string>;
  events: SpanEvent[];
  children: SpanNode[];
}
