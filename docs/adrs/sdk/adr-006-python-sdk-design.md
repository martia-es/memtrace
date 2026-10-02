# ADR-006: Diseñando el SDK Python de MemTrace inspirándose en LangSmith OTel Exporter

* **Estado**: Aceptado (decisiones 2 y 3 enmendadas por ADR-007)
* **Fecha**: 2026-09-26

## Contexto

MemTrace requiere una librería cliente en Python (`memtrace`) totalmente agnóstica al framework del agente (LangChain, LangGraph, Pydantic AI, AutoGen o código a medida) que capture trazas de ejecución y las exporte a través del protocolo estándar OpenTelemetry (OTLP).

Para asegurar robustez en entornos concurrentes y asíncronos, se analiza la implementación de observabilidad OTel de LangSmith (`langsmith._internal.otel._otel_exporter`).

## Decisiones Tomadas

1. **Almacén Thread-Safe de Spans en Vuelo (`_ThreadSafeSpanInfoStore`)**:
   - Mantener un registro protegido por `threading.Lock` que asocie UUIDs únicos de ejecución con las instancias de `Span` de OpenTelemetry y su timestamp de creación.
   - Implementar un mecanismo TTL (Time-To-Live) para limpiar automáticamente spans obsoletos en caso de errores no capturados o cierres incompletos.

2. **Conversión Determinista de UUIDs a Identificadores OTel**:
   - Convertir UUIDs (128 bits) a `trace_id` (128 bits int / 32 hex chars) y `span_id` (64 bits int / 16 hex chars) para mantener la relación de parentesco entre spans de forma determinista.

3. **Semántica Estandarizada GenAI (`gen_ai.*`)**:
   - Adoptar las especificaciones OTel GenAI SemConv:
     - `gen_ai.operation.name`: `chat`, `execute_tool`, `embeddings`.
     - `gen_ai.system`: Proveedor del modelo (`openai`, `anthropic`, `ollama`).
     - `gen_ai.request.model`, `gen_ai.response.model`.
     - `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.total_tokens`.
     - Atributos de plataforma `memtrace.span.kind`, `memtrace.trace.session_id`, `memtrace.metadata`.

4. **Aislamiento e Importaciones Dinámicas**:
   - Cargar módulos de OpenTelemetry dinámicamente (`try/except ImportError`) para evitar fallos si el entorno del usuario carece de ciertas dependencias.
   - `BatchSpanProcessor` para exportación asíncrona sin bloquear el hilo principal del agente.

## Consecuencias

* **Positivas**:
  - Compatibilidad total con cualquier agente o framework Python.
  - Aislamiento completo de fallos (*fail-safe*).
  - Estructura limpia y probada en producción.
* **Negativas**:
  - Requiere mantener la compatibilidad con las especificaciones cambiantes de OpenTelemetry GenAI.
