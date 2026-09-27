/** Detección del framework de agentes que originó un span (ADR-011). */

const MEMTRACE_FRAMEWORK = "memtrace.framework";

/** Marcador explícito que emite el SDK cuando envuelve el framework (p. ej. `MemTraceCallbackHandler`). */
const EXPLICIT_LABELS: Record<string, string> = {
  langchain: "LangChain",
  langgraph: "LangGraph",
};

/** Scope de instrumentación nativo del propio framework: no lo controla el SDK de MemTrace. */
const NATIVE_SCOPE_LABELS: Record<string, string> = {
  "pydantic-ai": "Pydantic AI",
  "opentelemetry.instrumentation.langchain": "LangChain",
};

/** null si el span no tiene ninguna señal reconocida (SDK usado sin ningún framework, o uno no soportado aún). */
export function detectFramework(scopeName: string, attributes: Record<string, string>): string | null {
  const explicit = attributes[MEMTRACE_FRAMEWORK];
  if (explicit && EXPLICIT_LABELS[explicit]) return EXPLICIT_LABELS[explicit];
  return NATIVE_SCOPE_LABELS[scopeName] ?? null;
}
