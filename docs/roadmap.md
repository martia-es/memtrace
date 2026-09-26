# MemTrace Roadmap

## Visión General

MemTrace es una plataforma integrada de observabilidad y aprendizaje para agentes de IA. El proyecto se divide en dos pilares complementarios:

- **Trace**: Recopilar, almacenar y analizar trazas de ejecución de agentes de IA
- **Mem**: Extraer conocimiento de las trazas para mejorar iterativamente el comportamiento de los agentes

El stack corre en Kubernetes local (kind/k3d, ver ADR-002 y ADR-006), permitiendo un ciclo de desarrollo rápido sin dependencias de servicios cloud.

---

## Fase 1: Trace - Plataforma de Trazabilidad

**Objetivo**: Implementar una herramienta de observabilidad tipo LangSmith que permita recopilar y analizar trazas de agentes de IA en tiempo real, corriendo en local sobre Kubernetes (kind).

### 1. Piezas necesarias

Antes de elegir tecnología, esto es lo que el sistema necesita resolver, pieza por pieza. Cada pieza se describe por su responsabilidad, no por su implementación — la implementación se decide más abajo y es intercambiable.

| # | Pieza | Problema que resuelve | Qué NO hace |
|---|---|---|---|
| 1 | **Instrumentación** | Generar el dato de traza dentro del proceso del agente (qué llamada a LLM se hizo, qué herramienta se ejecutó, cuánto tardó, si falló) y entregarlo hacia afuera en un formato estándar | No decide dónde se guarda ni cómo se consulta el dato |
| 2 | **Ingestión** | Recibir el flujo de trazas que llega desde (potencialmente) muchos agentes a la vez, agruparlo de forma eficiente y escribirlo en el almacén | No expone datos a nadie fuera del sistema; no aplica lógica de negocio |
| 3 | **Almacén analítico** | Guardar grandes volúmenes de trazas y responder consultas agregadas (latencias, tasas de error, filtros) muy rápido | No decide qué mostrar ni cómo se presenta |
| 4 | **API de consulta** | Ser el único punto de acceso al almacén: traduce peticiones del dashboard en consultas, agrega datos, reconstruye estructuras (como el árbol de ejecución de una traza) | No recibe trazas nuevas; no tiene lógica de presentación |
| 5 | **Interfaz visual** | Mostrar las trazas de forma navegable a una persona: listados, timelines, detalle de una ejecución, métricas de rendimiento | No accede a datos directamente — todo lo que muestra viene de la pieza 4 |

Esta tabla es el contrato del sistema. Cualquiera de las 5 piezas se puede reconstruir con otra tecnología sin tocar las demás, siempre que mantenga su responsabilidad y su forma de comunicarse con la vecina (ver siguiente sección).

### 2. Arquitectura decidida

Las 5 piezas se conectan en una única dirección de flujo de escritura y una única dirección de flujo de lectura, sin atajos:

```
FLUJO DE ESCRITURA (una traza nueva)
┌────────────────┐   OTLP      ┌──────────────┐   lote      ┌──────────────┐
│ 1. Instrumen-  │ ──────────► │ 2. Ingestión │ ───────────► │ 3. Almacén   │
│    tación      │  (estándar) │              │  (batch)     │   analítico  │
└────────────────┘             └──────────────┘             └──────┬───────┘
                                                                     │
FLUJO DE LECTURA (alguien abre el dashboard)                        │ consulta
┌────────────────┐   HTTP/JSON  ┌──────────────┐  ◄──────────────────┘
│ 5. Interfaz    │ ◄──────────► │ 4. API de    │
│    visual      │  (contrato)  │    consulta  │
└────────────────┘              └──────────────┘
```

**Reglas de la arquitectura** (no negociables, son las que mantienen el sistema desacoplado):

- **La pieza 1 nunca conoce a la pieza 3.** Habla exclusivamente por OTLP (el protocolo estándar de OpenTelemetry), no por un cliente específico de ninguna base de datos. Esto significa que el código del agente no cambia si mañana cambiamos de almacén.
- **La pieza 5 nunca conoce a la pieza 3.** Solo habla con la API de consulta (pieza 4) por HTTP/JSON. El dashboard no sabe si detrás hay ClickHouse, Postgres o un fichero — solo conoce el contrato de la API.
- **Escritura y lectura son procesos separados** (piezas 2 y 4 son servicios distintos, no el mismo proceso). Tienen perfiles de carga distintos: la ingestión es continua y en background, la consulta es puntual y a demanda del usuario. Si comparten proceso, un pico de una degrada a la otra.
- **La pieza 4 encapsula el conocimiento del esquema de almacenamiento.** Toda lógica específica del almacén (SQL, forma de reconstruir jerarquías, particionado) vive detrás de esta pieza. Si cambia el almacén, se reescribe la pieza 4 por dentro, pero su contrato hacia la pieza 5 no cambia.

Este es el principio general de desacoplo de infraestructura: **cada pieza expone un contrato estable hacia su vecina (OTLP, HTTP/JSON) y esconde su tecnología interna**. Cambiar la tecnología de una pieza es un cambio interno, no un cambio de contrato.

### 3. Tecnología elegida

La tecnología es el detalle de implementación de cada pieza — intercambiable siempre que se respete el contrato de la sección 2.

| Pieza | Tecnología | Por qué |
|---|---|---|
| 1. Instrumentación | OpenTelemetry SDK (Python/TypeScript, según el lenguaje del agente) | Es el estándar de facto para trazas de aplicaciones; exporta por OTLP, que es el contrato que necesitamos |
| 2. Ingestión | OpenTelemetry Collector (distribución `otelcol-contrib`) | Ya resuelve batching, reintentos, cola local persistente y escritura en ClickHouse sin programar un servicio de ingesta a mano |
| 3. Almacén analítico | ClickHouse | Base de datos columnar pensada para agregaciones rápidas sobre grandes volúmenes — ideal para "dame el P95 de latencia de las últimas 10.000 trazas" |
| 4. API de consulta | Next.js (App Router) + TypeScript | Sirve como backend-for-frontend: única capa con acceso al almacén, expone un contrato HTTP/JSON estable al dashboard |
| 5. Interfaz visual | Vite + Quasar Framework + ECharts/Recharts/D3.js | Dashboard SPA, consume solo la API de consulta |

**Cómo se traduce el desacoplo a código**: dentro de la pieza 4 (API de consulta), el acceso a ClickHouse debe quedar detrás de una interfaz propia (p. ej. un módulo `TraceRepository` con métodos como `listTraces()`, `getTraceById()`), nunca con SQL disperso por los endpoints. Así, cambiar de ClickHouse a otro almacén columnar el día de mañana implica escribir una nueva implementación de esa interfaz, no reescribir la API.

### Atributos de las trazas: usar convenciones estándar

Los atributos que la pieza 1 adjunta a cada span (modelo usado, tokens, prompt, completion) deben seguir las [Semantic Conventions for Generative AI](https://opentelemetry.io/docs/specs/semconv/gen-ai/) de OpenTelemetry (prefijo `gen_ai.*`) en vez de inventar nombres propios. Esto evita incompatibilidades futuras con otras herramientas del ecosistema OTel y facilita integrar librerías de terceros que ya emiten estos atributos.

### Deliverables Fase 1

- [ ] Librería OpenTelemetry (SDK) para agentes — solo exporta OTLP, sin conocimiento del almacén
- [ ] Configuración del OTel Collector con pipeline de batching + cola persistente + escritura en ClickHouse
- [ ] Esquema de datos en ClickHouse, con migraciones versionadas
- [ ] API de consulta (Next.js) con acceso al almacén encapsulado detrás de un repositorio propio
- [ ] Dashboard (Quasar) que consume únicamente la API de consulta
- [ ] Manifiestos de Kubernetes (`k8s/`) con las 5 piezas como servicios independientes
- [ ] Documentación y ejemplos de integración

---

## Fase 2: Mem - Aprendizaje Iterativo del Agente

**Objetivo**: Extraer conocimiento de las trazas para mejorar el comportamiento del agente y evitar errores recurrentes.

### Componentes Técnicos

#### 2.1 Motor de Análisis de Trazas
- **Tecnología**: Redis Stack OpenSource
- **Propósito**: Procesar trazas para extraer patrones de éxito/fallo
- **Operaciones**:
  - Clasificar trazas: exitosas vs fallidas
  - Identificar causas raíz de fallos
  - Extraer patrones recurrentes (ej: "el agente falla cuando usa tool X con parametro Y")
  - Generar embeddings de trazas fallidas para similitud

#### 2.2 Knowledge Graph
- **Almacenamiento**: Redis Stack (grafos + search)
- **Nodos**:
  - Agentes
  - Herramientas/Tools
  - Modelos LLM
  - Patrones de error
  - Estrategias exitosas
- **Relaciones**:
  - Agent usa Tool
  - Tool falla en contexto X
  - Estrategia Y resuelve error Z

#### 2.3 Feedback Loop del Agente
- **Mecanismo**: Inyectar conocimiento en el prompt/contexto del agente
- **Ejemplos**:
  - Ejemplos de uso correcto de tools fallidos
  - Patrones de error a evitar
  - Estrategias alternativas cuando falla una herramienta
  - Instrucciones contextuales basadas en historial

#### 2.4 Sistema de Métricas de Aprendizaje
- **Tracking**:
  - Tasa de éxito del agente en el tiempo
  - Reducción de errores recurrentes
  - Mejora en latencia/tokens tras aplicar feedback
  - Precisión de las correcciones sugeridas

### Algoritmos de Extracción de Conocimiento

1. **Clustering de Fallos**: Agrupar trazas fallidas por causa raíz
2. **Pattern Mining**: Identificar secuencias de acciones que llevan a fallo
3. **Embeddings + RAG**: Buscar trazas similares en el knowledge graph
4. **Scoring**: Calificar qué aprendizajes son más valiosos

### Deliverables Fase 2

- [ ] Motor de análisis de trazas (ClickHouse → Redis)
- [ ] Knowledge graph schema en Redis Stack
- [ ] Pipeline de extracción de patrones y reglas
- [ ] Servicio de recomendación de feedback para agentes
- [ ] API para inyectar contexto en prompts
- [ ] Dashboard de evolución del agente (métrica en el tiempo)
- [ ] Documentación de integración con agentes

### Stack Técnico

```
Análisis: Python (pandas, scikit-learn)
Knowledge Store: Redis Stack (graphs + search)
API: FastAPI
Embeddings: Sentence Transformers / OpenAI
Monitoreo: Prometheus + Grafana (opcional)
```
