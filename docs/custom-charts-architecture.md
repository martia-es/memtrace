# Custom charts: cómo se construyen y cómo se mapea OTel a preguntas de negocio

Documento técnico (no es un ADR). Describe el estado actual del código y recoge las decisiones de los
antiguos ADR-026, 027, 030, 035 y 057, ya retirados ([índice](adrs/README.md#retired-adrs)). Las convenciones
de presentación están en [ui-conventions.md](ui-conventions.md).

## 1. Resumen en una frase

Los spans OTel se guardan **tal cual** en ClickHouse. No hay ninguna tabla de "conceptos de negocio":
el significado se reconstruye en **tres puntos** (SDK, consulta SQL de la API, vocabulario del
frontal), y la gráfica guardada es solo una definición declarativa en PostgreSQL.

```
 App del usuario
   │  SDK Python: decoradores / handlers / auto-instrumentación
   │  SanitizingSpanExporter  → redacta secretos + completa gen_ai.* + infiere memtrace.step_type   [1]
   ▼
 OTel Collector (OTLP 4317/4318) → exporter clickhouse
   ▼
 ClickHouse  memtrace.otel_traces   (1 fila = 1 span, SpanAttributes Map(String,String))
   ▲
   │  SQL parametrizado; clasifica cada span en un "kind" con la expresión KIND                    [2]
 API (Next.js, /api/v1/experiments/:id/…)  ── PostgreSQL: custom_metrics (definición JSONB)
   ▲
   │  JSON: listas de step types, claves, valores, puntos {label, value}
 Dashboard (Vue)  custom-chart-vocabulary.ts traduce nombres técnicos → negocio                   [3]
```

## 2. Qué se guarda y dónde

| Dato | Almacén | Notas |
|---|---|---|
| Spans (datos de los gráficos) | ClickHouse `memtrace.otel_traces` | Esquema estándar del exporter de OTel Collector. TTL 30 días. |
| Definición de un gráfico guardado | PostgreSQL `custom_metrics` (`definition JSONB`) | La valida la API con zod al guardar, no la BD. |
| Informes (grid de gráficos) | PostgreSQL (ADR-035) | Solo referencia a `custom_metrics.id` + posición `x,y,w,h`. |
| Nombres de negocio | **En ningún sitio** | Se calculan en el frontal al mostrar (`custom-chart-vocabulary.ts`). |

No existe tabla de catálogo ni de "tipos de paso": un step type es solo un valor que aparece en
`SpanAttributes['memtrace.step_type']`. Descubrirlos es un `GROUP BY` en tiempo de consulta, por eso
un paso nuevo aparece en el builder sin migraciones ni registro previo.

Columnas de `otel_traces` que usa esta funcionalidad (`migrations/clickhouse/001_init_traces.sql`):
`Timestamp`, `ServiceName`, `SpanAttributes` (Map), `Duration` (ns), `StatusCode`. Orden de la tabla:
`(ServiceName, SpanName, Timestamp)`; hay un índice bloom sobre `mapKeys(SpanAttributes)`.

**Experimento = `ServiceName`.** La API resuelve el experimento de la URL a su `serviceName` y lo
inyecta en cada consulta (`withServiceFilter` en las rutas, `service` en el handler). El cliente
nunca elige el servicio, así que un usuario no puede consultar spans de otro experimento.

## 3. Cómo se convierte un span en "un tipo de paso"

Hay **dos** inferencias, una en el cliente (SDK) y otra en la consulta (API). Son complementarias.

### 3.1 En el SDK (`sdk/python/memtrace/`)

1. Los decoradores/context managers propios (`@trace_step`, handlers de LangChain, Pydantic AI…)
   escriben `memtrace.step_type` explícitamente (`attributes.py::step_start_attributes`) y, si el tipo
   es built-in, también `gen_ai.operation.name` (`llm→chat`, `tool→execute_tool`,
   `agent→invoke_agent`, `retriever→retrieval`, `embedding→embeddings`). Un step type libre
   (`"guardrail.regex_pii"`) se guarda tal cual, sin `gen_ai.operation.name`.
2. `SanitizingSpanExporter` (ADR-021) es la última parada antes de salir del proceso y se aplica a
   **todos** los spans, también los de librerías de terceros auto-instrumentadas. Hace tres cosas:
   redacta secretos, completa atributos `gen_ai.*` mediante normalizadores y, si falta
   `memtrace.step_type`, lo infiere (`infer_step_type`):
   - `gen_ai.operation.name` → step type (mapa inverso de la tabla anterior);
   - si no, `traceloop.span.kind`: `workflow/task → chain`, `agent`, `tool`, `llm`.

### 3.2 En la API: la expresión `KIND`

`clickhouse-trace-repository.ts` define una única expresión SQL que se reutiliza en todas las
consultas de gráficos:

```sql
multiIf(
  SpanAttributes['memtrace.step_type'] != '', SpanAttributes['memtrace.step_type'],
  SpanAttributes['gen_ai.operation.name'] = 'chat',         'llm',
  SpanAttributes['gen_ai.operation.name'] = 'execute_tool', 'tool',
  'unknown')
```

Es la red de seguridad para spans que no pasaron por el SDK (p. ej. datos de otro exportador OTel
directo al collector). Solo reconoce `llm` y `tool`; el resto cae en `unknown`. Si la lógica de
inferencia del SDK cambia, hay que revisar que esta expresión siga siendo coherente (están
duplicadas a propósito: una vive donde se genera el span y otra donde se lee).

## 4. La API: quién hace qué

Ruta base: `/api/v1/experiments/:experimentId/…`. Todas exigen `requireExperimentRead`. Arquitectura
hexagonal habitual: `route.ts` → `handlers.ts` (valida con zod, `schemas.ts`) → `TraceQueryService`
(`application/trace-query-service.ts`, resuelve rango temporal y bucket) → puerto `TraceRepository` →
`ClickHouseTraceRepository`.

| Endpoint | Método | Repositorio | Para qué sirve en el builder |
|---|---|---|---|
| `/span-kinds` | GET | `getStepKinds` | Chips de **"I want to see…"** (valores de `KIND` + conteo, máx. 200) |
| `/attribute-keys?stepTypes=a,b` | GET | `getAttributeKeys` | Opciones de **"Split by…"** y **"Only when…"** (`arrayJoin(mapKeys(SpanAttributes))`, máx. 200) |
| `/attribute-values?stepTypes=…&attribute=k` | GET | `getAttributeValues` | Valores seleccionables de un filtro (máx. 200) |
| `/metrics/custom` | POST | `getCustomMetric` | Ejecuta una definición y devuelve los puntos para pintar |
| `/custom-metrics` (GET/POST/DELETE) | – | PostgreSQL (identidad) | Guardar, listar y borrar definiciones |

### 4.1 Contrato de la definición (`customMetricDefinitionBody`)

```ts
{
  chartType: "bar" | "pie" | "line" | "area" | "number" | "table",
  stepTypes: string[],          // 1..20, valores de KIND
  metric: "count" | "avg_duration" | "p50_duration" | "p95_duration" | "error_rate",
  groupByAttribute: string | null,
  filters: { attribute: string, values: string[] }[]   // ≤10 filtros, ≤50 valores cada uno
}
```

Es un **enum cerrado**: no hay forma de que el usuario inyecte SQL ni expresiones. El tipo de métrica
y de gráfica lo traduce el servidor a una expresión fija; `filters`, `groupByAttribute` y `stepTypes`
van siempre como **parámetros ligados** de ClickHouse (`{name:Type}`), nunca concatenados.

### 4.2 Traducción a SQL (`getCustomMetric`)

| `metric` | Expresión |
|---|---|
| `count` | `count()` |
| `avg_duration` | `avg(Duration) / 1e6` (ms) |
| `p50_duration` / `p95_duration` | `quantile(0.5/0.95)(Duration) / 1e6` (ms) |
| `error_rate` | `countIf(StatusCode = ERROR) / count()` (fracción 0..1) |

- **Etiqueta de cada punto** (`label`): `KIND` por defecto, o `SpanAttributes[groupBy]` si hay
  `groupByAttribute` (excluyendo spans donde ese atributo está vacío).
- **WHERE**: rango temporal + `ServiceName` + `KIND IN stepTypes` + un
  `SpanAttributes[attr] IN (valores)` por filtro.
- `line`/`area`: agrupa también por bucket temporal
  (`intDiv(toUnixTimestamp(Timestamp), bucket) * bucket`); el bucket lo elige el servicio
  (`chooseBucketSeconds`: ≈60 puntos por rango, mínimo 60 s). Devuelve `timeseries`.
- Resto de tipos (`bar`, `pie`, `number`, `table`): un único agregado, `ORDER BY value DESC LIMIT 50`.
  Devuelve `points`.

La API **no** conoce nombres de negocio ni formatea valores: devuelve `label` crudo (un step type o el
valor del atributo), `value` numérico (ms o fracción) y nada más.

## 5. El frontal: dónde ocurre la traducción a negocio

Todo lo "de negocio" vive en `dashboard/src/domain/custom-chart-vocabulary.ts` (módulo puro, sin
Vue ni HTTP) y lo consumen `CustomChartsPanel.vue`, `ReportCard.vue`, `MetricReportView.vue` y
`custom-metric-chart-option.ts`. **La API no interviene en la traducción**: el frontal recibe nombres
técnicos y los presenta.

| Qué se traduce | Función | Mecanismo |
|---|---|---|
| Step type → nombre | `stepLabel` | Diccionario fijo para built-in (`llm`→"Model calls", `tool`→"Tool calls", `agent`→"Agent runs", `retriever`→"Document searches", `unknown`→"Other steps"); si no, `humanize()` (`input_guardrail`→"Input guardrail") |
| Clave de atributo → nombre | `attributeLabel` | Diccionario de 5 claves (`gen_ai.tool.name`→"Tool", `gen_ai.request.model`→"Model"…); si no, `humanize()` |
| Atributo técnico → ocultar | `isTechnicalAttribute` | Regex sobre prefijos (`memtrace.`, `otel.`, `telemetry.`, `gen_ai.usage.`, `exception.`, `code.`, `thread.`, `process.`, …). Se muestran con "Show technical details" |
| Métrica → frase | `METRIC_LABELS`, `METRIC_PHRASE`, `METRIC_TITLE` | Mapa estático por `MetricKind`. `SELECTABLE_METRICS` excluye `p50_duration` (válido si ya está guardado) |
| Valor → texto | `formatMetricValue` | `error_rate` ×100 con `%`; duraciones en ms o s; conteos con separador |
| Tipo de gráfica y nombre sugeridos | `suggestChartType`, `suggestName` | Sin desglose → `line`; con desglose → `bar`. Dejan de adaptarse cuando el usuario edita |
| Frase descriptiva | `describeDefinition` | Compone "Shows the number of tool calls for each tool, only when…" |
| Etiqueta de punto → nombre | `presentPointLabel` / `presentResult` | Solo traduce si **no** hay `groupByAttribute` (entonces el label es un step type) |
| Comparación con periodo anterior | `previousRange`, `describeChange`, `findOutlier` | El panel lanza dos consultas (`Promise.all`: rango actual y el equivalente anterior) |
| Preguntas "Start from a question" | `templatesFor` | Ver 5.1 |

### 5.1 Plantillas

`BUILT_IN_TEMPLATES` son 6 definiciones fijas (herramientas más usadas / que más fallan / más lentas;
llamadas a modelo por día / por modelo / latencia). Cada plantilla declara `requires: [step types]` y
solo se ofrece si todos están presentes en el resultado de `/span-kinds` para el rango. Además, por
cada step type **no built-in** (máx. 6) se generan dos genéricas: "How often does X happen?" (línea,
`count`) y "How often does X fail?" (número, `error_rate`).

Una plantilla es simplemente una `ChartDefinition` precargada: al pulsarla se rellena el formulario y
sigue siendo editable. No hay lógica de negocio escondida detrás.

### 5.2 Flujo del builder (`CustomChartsPanel.vue`)

1. Al cargar o cambiar el rango → `getStepKinds` → chips + `templatesFor(...)`.
2. El usuario elige pasos → `getAttributeKeys` (solo con **un** paso seleccionado) → opciones de
   "Split by" / "Only when" filtradas con `isTechnicalAttribute`.
3. Al elegir un atributo de filtro → `getAttributeValues`.
4. Cada cambio (con debounce) → `queryCustomMetric` (POST `/metrics/custom`) → vista previa;
   `customMetricChartOption` construye la opción de ECharts a partir de `points`/`timeseries`.
5. Guardar → POST `/custom-metrics` con `{ name, definition }`. Los gráficos guardados se recalculan
   al abrirlos (se guarda la definición, nunca los datos).

## 6. Informes (ADR-035)

Un informe guarda referencias a `custom_metrics.id` y su posición en un grid de 12 columnas. Al verlo,
el frontal pide cada gráfica por separado. El envío por email
(`reports/:reportId/send`) lo hace la API: recalcula cada gráfica con `getCustomMetric` y envía una
tabla de texto, sin pasar por el frontal. Como ahí no hay UI, los valores se formatean en el servidor.

## 7. Límites y comportamiento actual

- **Métricas**: solo conteo, duración (avg/p50/p95) y tasa de error. No se pueden agregar atributos
  numéricos (tokens, coste, scores).
- **Un solo `groupByAttribute`**, y solo con un step type seleccionado. Con varios pasos se compara
  un paso por serie.
- **Límites duros**: 50 puntos por gráfica agregada, 200 step types / claves / valores en
  descubrimiento, 20 step types y 10 filtros por definición.
- **Nombres**: los de pasos custom solo se humanizan, no son editables. Los atributos no se clasifican
  por cardinalidad (un `user_id` aparece igual que `gen_ai.tool.name`).
- **Valores de atributo = texto.** `SpanAttributes` es `Map(String, String)`: booleanos y números
  llegan como cadenas (`"true"`, `"3"`). Filtrar y agrupar funciona; medir sobre ellos no.
- **Retención**: 30 días (TTL de ClickHouse). Los gráficos guardados no se rompen, simplemente
  devuelven menos datos.
- **Cobertura de `KIND` en SQL**: sin `memtrace.step_type`, solo `llm` y `tool` se infieren
  (`unknown` para el resto).

## 8. Dónde tocar cada cosa

| Quiero… | Cambio |
|---|---|
| Que un framework nuevo aparezca con el tipo correcto | `infer_step_type` en el SDK (y `KIND` si debe funcionar sin SDK) |
| Renombrar un paso o atributo built-in | `BUILT_IN_STEPS` / `ATTRIBUTE_LABELS` en `custom-chart-vocabulary.ts` |
| Ocultar más atributos técnicos | `TECHNICAL_ATTRIBUTE` en el mismo fichero |
| Añadir una pregunta predefinida | `BUILT_IN_TEMPLATES` en el mismo fichero |
| Añadir una métrica | `customMetricDefinitionBody` (zod), tipos en `api/src/domain/metrics.ts`, `metricExpr` en el repositorio, y `MetricKind` + etiquetas en el vocabulario |
| Nombres editables / catálogo en servidor | Pendiente en roadmap; el frontal ya consume nombres solo vía el módulo de vocabulario, así que cambia solo el origen del nombre |

## 9. Guía de instrumentación y comportamiento ante datos "sucios"

### 9.1 Qué debe hacer quien instrumenta

1. **Paso propio**: `trace_step` con un `step_type` libre y estable (`"input_guardrail"`). Ese texto
   es el identificador: si se cambia, es otro paso y se pierde el histórico en el gráfico.
2. **Atributos con significado de negocio**, como texto de baja cardinalidad
   (`guardrail.check = "pii"`, `guardrail.blocked = true`). Son los que sirven para "Split by" y
   "Only when".
3. **Ausente ≠ vacío**: si un dato no aplica, **no se emite** (el SDK descarta `None`,
   `attribute_sanitizer.py`). No hay que rellenar con `""`, `0` o `"unknown"`.
4. **Fallos**: `error_rate` mira solo `StatusCode = ERROR` del span. Si el paso "falla" como regla de
   negocio (guardrail que bloquea) pero el span termina OK, la tasa de error será 0. Para eso se usa
   `count` + condición `guardrail.blocked is true`, o se marca el span como error.

### 9.2 Qué pasa con cada caso

| Caso | Resultado hoy |
|---|---|
| Atributo ausente | ClickHouse devuelve `''` para una clave inexistente; esos spans quedan **fuera** de "Split by" y de la lista de valores. Correcto |
| Atributo con `""` | Igual que ausente (se filtra `!= ''`) |
| Atributo con valor centinela (`0`, `"unknown"`, `"none"`) | Es un valor más: aparece como categoría "0" en el desglose y en los filtros. **No hay forma de excluirlo**, solo de incluir los demás en "Only when" |
| Valor numérico (`risk_score = 0.82`) | Se guarda como texto; sirve para filtrar/agrupar pero cada valor distinto sería una categoría. No se puede promediar |
| Alta cardinalidad (ids, texto libre) | Aparece en los selectores igual que un atributo útil. Gráficas agregadas: se queda con el top 50; descubrimiento: top 200. Sin aviso al usuario |
| Mismo `step_type` escrito de dos formas (`Guardrail` / `guardrail`) | Son dos pasos distintos |
| Span sin `step_type` de un framework no reconocido | Cae en "Other steps" (`unknown`) |

### 9.3 Escalabilidad

**Lo que escala bien**
- Pasos y atributos nuevos funcionan sin tocar código, migraciones ni registro (son datos, no esquema).
- Datos y definición están separados: ClickHouse crece por volumen de spans, PostgreSQL solo guarda JSON
  pequeño por gráfica.
- Acceso aislado por experimento (`ServiceName`) y consultas parametrizadas (sin SQL libre).
- `PARTITION BY toDate(Timestamp)` y TTL de 30 días acotan el escaneo de cualquier rango.
- La definición evoluciona sin migrar si los campos nuevos tienen `default` en zod (así se añadieron
  `filters` y `groupByAttribute`).

**Lo que hay que vigilar** (revisado en código, no medido con carga)
- La gráfica de líneas/áreas con "Split by" **no tiene `LIMIT`**: un atributo de alta cardinalidad
  genera una serie por valor y por bucket. Las gráficas agregadas sí limitan a 50.
- `SpanAttributes` es un único `Map` que también contiene contenidos grandes
  (`gen_ai.input.messages`, `gen_ai.output.messages`). Leer `SpanAttributes['x']` en versiones de
  ClickHouse sin subcolumnas de Map eficientes puede leer todo el mapa. Conviene medirlo con volumen
  real; si pesa, promocionar a columnas materializadas `step_type` y los atributos más usados.
- No hay caché: cada vista previa, cada gráfica guardada y cada tarjeta de un informe lanza su propia
  consulta; la comparación con el periodo anterior duplica la consulta. Solo hay un limitador de
  concurrencia en el repositorio.
- Añadir una métrica nueva toca cuatro sitios (zod, tipos de la API, SQL, vocabulario del frontal) y
  renombrar o quitar una existente rompe las gráficas ya guardadas.

### 9.4 Evolución prevista (roadmap)

El catálogo editable en servidor (roadmap, ADR-057) cubriría justo los huecos de 9.2: clasificación
automática de atributos por tipo y cardinalidad (ocultar ids y texto libre), métricas sobre atributos
numéricos, y nombres editables. Valores centinela como `0` seguirán necesitando una acción explícita
("ignorar este valor"), que hoy no está prevista y habría que decidir al diseñarlo.
