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

### Instrumentación manual: árboles de pasos custom sobre las Gen AI Conventions

Además de la instrumentación automática (Gen AI Conventions para llamadas a LLM), cada agente puede instrumentar manualmente cualquier paso interno que no sea una llamada a un modelo (reglas, regex, clasificadores clásicos, validaciones...) como un span propio, anidado bajo el nodo que lo contiene (p. ej. los distintos pasos de un guardrail de entrada en un grafo de LangGraph). Estos spans custom viajan por el mismo pipeline OTLP → ClickHouse sin tratamiento especial, y se consultan y visualizan igual que cualquier otro span. Ver [ADR-026](adrs/observability/adr-026-custom-step-trees.md) y la guía de [Tracing steps](../docs-site/library/tracing.md).

### Métricas custom sobre spans definidos por el usuario

Como los pasos custom son spans normales (mismo almacén, mismo `memtrace.step_type` libre en `SpanAttributes`), el usuario puede construir sus propias gráficas en la pantalla de Metrics sobre ellos — p. ej. "cuántas veces saltó el guardrail de entrada" — sin que MemTrace conozca de antemano qué pasos custom existen. Implementado como un *query builder* declarativo (tipo de span + métrica agregada + filtros + agrupación opcional por un atributo, todo elegido mediante selectores alimentados por endpoints de descubrimiento — nunca SQL libre del usuario), con las definiciones de gráfico guardadas en PostgreSQL (no en ClickHouse). Ver [ADR-027](adrs/evaluation/adr-027-custom-metrics-on-custom-spans.md) y su ampliación, [ADR-030](adrs/evaluation/adr-030-expand-custom-charts-builder.md).

### Informes guardados: varias custom charts en un grid, compartidos por experimento

Un usuario puede agrupar varias gráficas custom ya guardadas en un **informe** con nombre propio y layout de grid libre (arrastrar/redimensionar), que aparece como su propia pestaña en Metrics — visible para cualquiera con acceso al experimento, igual que una gráfica guardada hoy. El informe solo referencia las gráficas (no las duplica): editar una gráfica en Custom charts se refleja en todos los informes que la usan. Incluye envío por email de una instantánea en texto (una tabla de valores por gráfico, recalculada al enviar) — sin PDF ni imagen renderizada, eso queda explícitamente para una futura ADR si se prioriza. Ver [ADR-035](adrs/evaluation/adr-035-saved-metric-reports.md).

### Deliverables Fase 1

- [x] Librería OpenTelemetry (SDK) para agentes — solo exporta OTLP, sin conocimiento del almacén
- [x] Instrumentación manual componible: árboles de spans custom (no-LLM) anidados bajo cualquier paso, sin cambios de esquema en el almacén — ver ADR-026
- [x] Métricas custom en el dashboard sobre spans definidos por el usuario (query builder declarativo) — ver ADR-027/030
- [x] Informes guardados: grid de varias custom charts por experimento, compartido y enviable por email (sin PDF) — ver ADR-035
- [x] Custom charts para perfiles de negocio: plantillas "empieza por una pregunta", nombres de negocio en vez de `step_type`/atributos crudos, flujo en 3 pasos con vista previa en vivo y tipo de gráfica/nombre sugeridos — ver [ADR-057](adrs/ui/adr-057-business-vocabulary-for-custom-charts.md)
- [x] Resumen de errores en lenguaje de negocio en el Overview: reglas deterministas (sin IA) que agrupan los spans fallidos por causa, con impacto y tendencia — ver [ADR-066](adrs/observability/adr-066-business-error-overview.md)
- [ ] Catálogo de datos editable en servidor para Custom charts (pasos y atributos autodescubiertos con nombre editable, clasificación automática de atributos por tipo/cardinalidad, métricas numéricas sobre atributos); sin depender de etiquetas en el SDK
- [x] Configuración del OTel Collector con pipeline de batching + cola persistente + escritura en ClickHouse
- [x] Esquema de datos en ClickHouse, con migraciones versionadas
- [x] API de consulta (Next.js) con acceso al almacén encapsulado detrás de un repositorio propio
- [x] Dashboard (Quasar) que consume únicamente la API de consulta
- [x] Manifiestos de Kubernetes (`k8s/`) con las 5 piezas como servicios independientes
- [x] Documentación y ejemplos de integración

---

## Fase 1.5: Gobierno - Autenticación y Control de Acceso

**Objetivo**: Antes de ampliar funcionalidad (Fase 2), cerrar el hueco de seguridad de Fase 1: hoy cualquiera con acceso de red puede leer el dashboard, llamar a la API de consulta o inyectar trazas falsas por OTLP. Esta fase introduce identidad (login federado con Google y Microsoft) y autorización (roles) sin romper el desacoplo de piezas definido en Fase 1.

### 1. Piezas necesarias

| # | Pieza | Problema que resuelve | Qué NO hace |
|---|---|---|---|
| 6 | **Autenticación (Identity)** | Verificar quién es la persona que entra al dashboard, delegando la verificación de credenciales a Google/Microsoft (OIDC) y emitiendo una sesión propia | No decide qué puede hacer esa persona una vez identificada |
| 7 | **Autorización (RBAC de 2 niveles: organización + experimento)** | Decidir, para cada petición a la API de consulta (pieza 4), si el usuario autenticado es `org_admin` de la organización dueña del experimento, o tiene membership (y con qué rol) en el experimento concreto | No gestiona el login ni almacena credenciales de terceros |
| 8 | **Almacén de identidad** | Persistir organizaciones, usuarios, la membership de organización (usuario, organización, `org_admin`), experimentos (cada uno pertenece a una organización), la membership de experimento (usuario, experimento, rol) y el vínculo con la cuenta de Google/Microsoft con la que iniciaron sesión | No es el almacén analítico de trazas (pieza 3); es un almacén transaccional distinto, con otro patrón de acceso |
| 9 | **Autenticación de agentes** | Verificar que quien envía trazas por OTLP (pieza 1 → pieza 2) es un agente/servicio autorizado a escribir, no cualquiera con acceso de red al Collector | No gestiona usuarios humanos ni sesiones de dashboard |

### 2. Arquitectura decidida

- **La autenticación humana y la autorización viven en la pieza 4 (API de consulta)**, igual que hoy toda lógica de almacenamiento vive ahí. La pieza 5 (dashboard) nunca valida permisos por su cuenta: solo redirige al login y adjunta la sesión en cada petición. Esto mantiene la regla de Fase 1 de que la pieza 5 solo habla con la pieza 4.
- **El almacén de identidad (pieza 8) es independiente del almacén analítico (pieza 3).** Usuarios, roles y sesiones son datos transaccionales (pocas filas, escrituras puntuales, necesidad de integridad referencial) muy distintos de las trazas (altísimo volumen, solo lectura agregada). Mezclarlos en ClickHouse sería forzar una herramienta OLAP a hacer de OLTP.
- **La autenticación de agentes (pieza 9) es un mecanismo aparte y más simple**: un token/API key por agente o servicio, validado en el borde de la pieza 2 (Ingestión), antes de que la traza llegue al almacén. No sustituye al login humano, resuelve un problema distinto (quién puede escribir, no quién puede leer).
- **Multi-tenant desde el modelo de datos: `Organización` contiene N `Experimento`.** Un experimento son las trazas + dashboard de un agente concreto (equivalente a "experimento" en otras plataformas de observabilidad de IA), y pertenece a exactamente una organización. Esto permite que una empresa agrupe todos sus agentes bajo una misma organización.
- **Evolución de roles (propuesta, [ADR-052](adrs/identity/adr-052-permission-based-roles-and-external-identity-mapping.md))**: los roles pasan a ser conjuntos de permisos guardados como datos, no comparaciones de nombre en el código. Experimento: `technical` y `business` (desaparece `admin` de experimento; invitar y gestionar API keys ajenas es del `org_admin`). Los roles se asignan a mano o desde un proveedor de identidad externo (grupos/roles del token OIDC, después SCIM 2.0) para conectar con Entra ID, SailPoint u Okta. Las fases A, B y C (permisos, roles `technical`/`business`, grupos del token OIDC y SCIM 2.0) están implementadas; la descripción de abajo es la versión original.
- **3 roles en total, en 2 niveles distintos:**
  - `org_admin` (nivel organización): tiene admin implícito sobre **todos** los experimentos de su organización, sin necesitar membership explícita en cada uno. Puede crear experimentos nuevos dentro de la organización e invitar usuarios (como `org_admin`, o directamente a un experimento como `admin`/`member`).
  - `admin` (nivel experimento): igual que `member`, más invitar a otros usuarios a ese experimento concreto (como `admin` o `member`). No tiene visibilidad sobre otros experimentos de la organización salvo que se le invite a ellos también.
  - `member` (nivel experimento): lectura sobre ese experimento (trazas, dashboard, métricas), generar su propia API key para instrumentar el agente (ver [ADR-016](adrs/identity/adr-016-admin-page-visible-to-experiment-members.md)) y **anotar trazas** (etiquetas humanas, [ADR-037](adrs/evaluation/adr-037-human-annotations-storage-and-api.md)) y revisar las colas de anotación ([ADR-039](adrs/evaluation/adr-039-annotation-queues.md)) en las que figure como revisor ([ADR-051](adrs/evaluation/adr-051-explicit-queue-reviewers.md)). No puede invitar ni gestionar a nadie, ni crear/editar rúbricas o colas.
- **Regla de autorización**: acceso a un experimento = `org_admin` de su organización **OR** membership directa en ese experimento. La pieza 7 evalúa ambas condiciones en cada petición.
- **Bootstrap**: cualquier usuario autenticado puede crear una organización nueva y se convierte en su primer `org_admin`. Crear un experimento dentro de una organización requiere ser `org_admin` de esa organización (ya no "cualquier usuario autenticado", como en la versión anterior de este documento).

### 3. Tecnología propuesta (a confirmar con ADR al implementar)

| Pieza | Tecnología candidata | Por qué |
|---|---|---|
| 6. Autenticación | Auth.js (NextAuth) con providers OIDC de Google y Microsoft (Azure AD) | Ya vivimos en Next.js (pieza 4, ver Fase 1); Auth.js resuelve el flujo OAuth/OIDC completo sin implementar el protocolo a mano |
| 7. Autorización | Middleware propio en la API de consulta, roles resueltos desde la pieza 8 | Evita acoplar la lógica de negocio de roles a una librería externa |
| 8. Almacén de identidad | PostgreSQL (instancia propia en el cluster kind) | Motor transaccional estándar, con integridad referencial para usuarios/roles; separado físicamente de ClickHouse |
| 9. Autenticación de agentes | API key estática por agente, validada en el OTel Collector (extensión de auth) o en un proxy delante de él | No requiere sesión ni OIDC — es máquina a máquina |

### Prerrequisitos antes de implementar esta fase

- ~~Definir el modelo de roles mínimo viable~~ — **Resuelto**: 2 roles (`admin`, `member`), scoped por experimento, sin rol global. Ver sección 2.
- ~~Registrar aplicaciones OAuth en Google Cloud Console y Microsoft Entra ID~~ — **Resuelto**: en `.env` están `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` y `MICROSOFT_APPLICATION_ID`/`MICROSOFT_TENANT_ID`/`MICROSOFT_CLIENT_SECRET`. Queda pendiente decidir el dominio/HTTPS del redirect URI si se despliega fuera de `localhost`.
- ~~Gestión de secretos~~ — **Resuelto por ahora**: en `.env` (fuera de git), igual que el resto de configuración local. Se revisita cuando se plantee desplegar en Cloud (entonces sí hará falta un secret manager real).
- ~~Decidir single-tenant o multi-tenant~~ — **Resuelto**: multi-tenant. `Organización` agrupa N `Experimento`, con un rol `org_admin` adicional a nivel organización. Ver sección 2.
- Esta fase requiere su propio ADR, dado que introduce una decisión de arquitectura importante: un segundo almacén de datos (PostgreSQL) además de ClickHouse. Ver [ADR-013](adrs/identity/adr-013-identity-postgres-and-oauth-rbac.md).

### Deliverables Fase 1.5

- [x] Decisión de modelo de roles: multi-tenant, `org_admin` (organización) + `admin`/`member` (experimento)
- [x] Registrar apps OAuth en Google Cloud Console y Microsoft Entra ID
- [x] Login con Google (OIDC) funcionando en el dashboard
- [x] Login con Microsoft/Azure AD (OIDC) funcionando en el dashboard
- [x] Almacén de identidad (PostgreSQL) con esquema de organizaciones / usuarios / experimentos / membership de organización (usuario, organización, `org_admin`) / membership de experimento (usuario, experimento, rol) / sesiones
- [x] Creación de organización: cualquier usuario autenticado puede crear una y pasa a ser su primer `org_admin`
- [x] Creación de experimento: solo un `org_admin` de la organización puede crear experimentos dentro de ella
- [x] Flujo de invitación a organización: un `org_admin` invita a otro usuario como `org_admin` de esa organización
- [x] Flujo de invitación a experimento: un `admin` (o `org_admin`) invita a otro usuario como `admin`/`member` de ese experimento
- [x] Middleware de autorización en la API de consulta aplicado a todos los endpoints existentes de Fase 1, evaluando `org_admin` OR membership de experimento
- [x] Autenticación por API key para agentes en el OTel Collector — implementada como proxy delante del collector, validando el key antes de reenviar OTLP; el collector en sí no tiene extensión de auth propia
- [x] ADR de la decisión de arquitectura (segundo almacén + estrategia de auth) — [ADR-013](adrs/identity/adr-013-identity-postgres-and-oauth-rbac.md)
- [x] Documentación de cómo dar de alta un usuario/agente nuevo — ver [README.md](../README.md#-alta-de-un-usuario-nuevo)

---

## Fase 1.75: Evaluación Offline

**Objetivo**: dar a quien usa la librería MemTrace la capacidad de evaluar la calidad de su propio agente contra un dataset de ejemplos — comparar versiones antes de desplegar, detectar regresiones — sin obligarle a depender del almacén ni de la API de MemTrace para definir su lógica de evaluación. Esta fase cubre solo evaluación **offline** (bajo demanda, contra un dataset curado); la evaluación **online** (muestreo continuo sobre tráfico de producción) queda fuera de alcance y se revisita en una fase futura.

> Nota de nomenclatura: aquí "ejecución de dataset" (`dataset_run`) es el resultado de correr un dataset completo contra una versión del agente. No debe confundirse con "Experimento" (Fase 1.5), que es la unidad multi-tenant de trazas+dashboard de un agente.

### 1. Piezas necesarias

| # | Pieza | Problema que resuelve | Qué NO hace |
|---|---|---|---|
| 11 | **Evaluador (`Evaluator`)** | Definir la métrica de calidad: una función que recibe `input`/`output`/`expected_output`/`trace` y devuelve un score | No ejecuta el agente, no decide de dónde vienen los datos ni qué se hace con el resultado |
| 12 | **Ejecutor de experimentos (`run_experiment`)** | Orquestar: iterar el dataset, invocar la función del agente (`task`) para cada item, correr los evaluadores sobre el resultado y agregar el resultado final | No es un servicio de MemTrace: corre dentro del proceso del propio usuario (script, notebook, job de CI) |
| 13 | **Fuente de dataset (`DatasetSource`)** | Dar acceso a los ejemplos a evaluar (input + output esperado) | No impone de dónde vienen: MemTrace ofrece un adaptador por defecto contra su propia API, pero el usuario puede pasar sus propios datos sin tocar esa API |
| 14 | **Sumidero de resultados (`ResultsSink`)** | Decidir qué pasa con los scores generados por una ejecución | No impone subirlos a MemTrace: por defecto los sube a su API, pero el usuario puede quedarse solo con el resultado en memoria o enviarlo a su propio sistema |
| 15 | **Almacén de datasets** | Persistir `dataset` / `dataset_item` / `dataset_run`: datos curados a mano, pocas filas, con integridad referencial | No es el almacén analítico de trazas (pieza 3) |
| 16 | **Almacén de scores** | Persistir los resultados de evaluación (un score por evaluador por traza), con el mismo perfil de volumen y escritura que las trazas | No decide qué se muestra (eso es la pieza 5) |

### 2. Arquitectura decidida

- **El ejecutor de experimentos (pieza 12) vive en el proceso del usuario, no es un servicio nuevo de MemTrace.** No hay backend que orqueste la ejecución; es una función de la librería que el usuario invoca desde su propio código (igual que hace la instrumentación de la pieza 1). Esto evita infraestructura nueva para esta fase.
- **`Evaluator` y `TaskFunction` son protocolos agnósticos de MemTrace.** Solo reciben tipos planos (`input`, `output`, `expected_output`, `trace`), nunca una clase propia de MemTrace. Un evaluador escrito para MemTrace es reutilizable fuera, y viceversa.
- **`DatasetSource` y `ResultsSink` son puertos con un adaptador HTTP propio como opción por defecto, nunca obligatoria.** El usuario puede pasar una lista de ejemplos local (sin llamar a la API de MemTrace) y puede desactivar la subida de resultados (`upload=False`) y recibir el resultado en memoria. Esto mantiene la librería desacoplada de la herramienta, siguiendo el mismo principio de puertos/adaptadores ya usado en la pieza 4 (`TraceRepository`).
- **Los scores (pieza 16) van a ClickHouse, no a Postgres.** Crecen al mismo ritmo que las trazas (un score por evaluador por traza), es un patrón de escritura por lotes y consulta agregada — el mismo criterio de volumen que ya separa trazas (ClickHouse) de identidad (Postgres) en ADR-013.
- **Los datasets (pieza 15) van a Postgres, junto al almacén de identidad de Fase 1.5.** Son datos curados a mano, pocas filas, editados con integridad referencial — mismo criterio que ya se aplicó a usuarios/organizaciones.
- **La API de consulta (pieza 4) gana endpoints nuevos, pero sigue siendo pasiva.** Expone lectura/escritura de datasets y scores; no orquesta ninguna ejecución. Todos los endpoints nuevos pasan por el mismo middleware de autorización de Fase 1.5.

### 3. Tecnología propuesta (a confirmar con ADR al implementar)

| Pieza | Tecnología candidata | Por qué |
|---|---|---|
| 11-14. SDK de evaluación | Python, dentro del paquete `memtrace` existente (`sdk/python/memtrace/application` para los protocolos, `sdk/python/memtrace/adapters/outbound` para el adaptador HTTP por defecto) | Reutiliza la estructura hexagonal ya presente en el SDK (ver ADR-006, ADR-024) |
| 15. Almacén de datasets | PostgreSQL (misma instancia de la pieza 8, Fase 1.5) | Datos transaccionales de bajo volumen, ya tienes el motor |
| 16. Almacén de scores | ClickHouse (mismo almacén de la pieza 3) | Mismo perfil de volumen/consulta que las trazas |

### Deliverables Fase 1.75

- [x] Protocolos `Evaluator` y `TaskFunction` en el SDK, agnósticos de MemTrace
- [x] Función `run_experiment()` con ejecución client-side (sin servicio nuevo)
- [x] Puertos `DatasetSource` / `ResultsSink` + adaptador HTTP por defecto contra la API de MemTrace, con opción de desactivarlo
- [x] Evaluadores built-in básicos (ej. `exact_match`, `contains`) como punto de partida
- [x] Evaluadores LLM-as-judge (`Correctness`, `Faithfulness`) sobre una base `LLMJudgeEvaluator` y un puerto `LLMClient` agnóstico de proveedor — ver [ADR-029](adrs/evaluation/adr-029-llm-as-judge-evaluators.md)
- [x] Esquema `dataset` / `dataset_item` / `dataset_run` en PostgreSQL (`migrations/postgres/006_evaluation.sql`)
- [x] Tabla `scores` en ClickHouse (`migrations/clickhouse/005_scores.sql`)
- [x] Endpoints en la API de consulta: datasets, dataset_runs, scores — ver [Query API](../docs-site/platform/api.md)
- [x] Versionado automático de datasets (semver major/minor) con auditoría por item (autor/fecha de alta y de última edición) y gestión de datasets/items desde el dashboard — ver [ADR-031](adrs/datasets/adr-031-dataset-versioning.md) y [ADR-032](adrs/datasets/adr-032-automatic-dataset-versioning-and-item-audit.md); historial con diff real entre versiones (cualquiera contra cualquiera) en [ADR-033](adrs/datasets/adr-033-stable-item-identity-and-version-diff.md); el SDK puede fijar una versión concreta (`dataset_version="2.1"`) y leer datasets locales `.json`/`.jsonl`
- [x] Edición de items estilo hoja de cálculo en el dashboard con borrador local y **una versión por sesión publicada** (`POST .../changes`, nota y bump automáticos; pegar desde Excel, selección múltiple, búsqueda) — ver [ADR-041](adrs/datasets/adr-041-spreadsheet-editing-with-publish-per-session.md)
- [x] Vista de comparación de `dataset_run` en el dashboard (`DatasetsPage.vue`, `DatasetRunDetailPage.vue`), navegación Datasets/Runs separada (`RunsPage.vue`)
- [x] Runs que registran siempre la versión exacta del dataset leída, subida incremental por lotes (run `running`/`completed`) y agregados locales en `ExperimentResult.summary()` — ver [ADR-034](adrs/evaluation/adr-034-run-records-dataset-version-and-uploads-incrementally.md)
- [x] Identidad del juez (modelo + huella de la rúbrica) guardada en cada score `llm_judge` — ver [ADR-043](adrs/evaluation/adr-043-record-judge-identity-on-scores.md)
- [x] Pestaña **Metrics → Offline evals** en el dashboard (Overview con veredicto de salud, tarjetas por evaluador con barra/sparkline y gráfica aprobados-vs-fallados del último run, útil con una sola run): tendencia por evaluador, vista de una run, comparación de dos runs (incluye cambios del dataset entre versiones) y latencia cuando hay trazas enlazadas. Sus límites iniciales (texto duplicado por evaluador, `Value` como String, sin latencia/tokens por item) están en [ADR-042](adrs/evaluation/adr-042-offline-evaluation-storage-model-limitations.md). El objetivo de pass rate (por defecto 80%) es configurable por evaluador en su score config boolean — [ADR-060](adrs/evaluation/adr-060-per-evaluator-pass-rate-target.md)
- [x] Almacenamiento de resultados dividido en `eval_items` (texto del item una vez) y `eval_scores` (valor tipado `ValueNum`), con latencia, tokens y coste de cada item leídos de su traza (el SDK abre una traza `eval.item` por item) y los chunks RAG leídos de los spans `retriever` (`memtrace.retriever.chunks`). Corte limpio de los datos anteriores — ver [ADR-044](adrs/evaluation/adr-044-eval-items-and-scores-tables-telemetry-from-traces.md)
- [x] Cierre de pendientes de evaluación — [ADR-045](adrs/evaluation/adr-045-evaluation-follow-ups-retrieval-metrics-summaries-retention-and-writer-user.md): métricas de recuperación (`RecallAtK`, `MRR`, `HitRate`) como evaluadores del SDK con etiquetas `metadata.relevant_docs`; resumen por run guardado al completarse (`eval_run_summaries`); particionado mensual y TTL de 180 días solo sobre el texto de los items; usuario ClickHouse `api_writer` con solo `INSERT` en las tablas de evaluación; el juez registra el modelo que el proveedor sirvió realmente (`LLMReply`); promoción en lote desde el detalle de una cola y creación de score configs desde el panel de anotación; arreglo de una carrera en el reparto de la cola
- [x] Score configs (rúbricas de anotación por experimento, tipo inmutable, rango solo ampliable, archivado) en la API y en Admin → experimento → Score configs — fase A, primera mitad: [ADR-036](adrs/evaluation/adr-036-score-configs-annotation-rubrics.md)
- [x] Anotación humana desde el detalle de traza: etiquetas por persona sobre la traza o un span, validadas contra las score configs, editables y retirables, junto a los scores automáticos de la misma traza (tabla `annotations` en ClickHouse) — fase A, segunda mitad: [ADR-037](adrs/evaluation/adr-037-human-annotations-storage-and-api.md)
- [x] Colas de anotación: lotes de trazas (o items de run) a revisar con una rúbrica de score configs, reparto *pull* con lease de 15 min, varias anotaciones independientes por item, progreso por revisor y pantalla de revisión en el dashboard (estado en PostgreSQL, etiquetas en ClickHouse) — fase C: [ADR-039](adrs/evaluation/adr-039-annotation-queues.md)
- [x] Feedback de usuario final (👍/👎): voto ligado a la traza de la respuesta en ClickHouse (`user_feedback`), endpoint con API key de agente o sesión, `memtrace.feedback()` en el SDK, columna y franja de color en trazas/conversaciones, satisfacción y desalineación con la revisión humana en el resumen, y 👍/👎 en el panel «Talk» y en el Weather Assistant (campo `chat_trace_id_field`) — [ADR-062](adrs/observability/adr-062-end-user-feedback-on-traces.md)
- [x] Revisores explícitos por cola: cada cola lleva la lista de personas que pueden anotar (tabla `annotation_queue_reviewers`), `requiredAnnotations` no puede superar su tamaño y las colas anteriores se migran con los miembros del experimento — [ADR-051](adrs/evaluation/adr-051-explicit-queue-reviewers.md)
- [x] Resultados de cola para el perfil técnico: pestaña Results (qué respondió cada revisor por item y criterio, desacuerdos), resolución del técnico en una capa aparte (`annotation_queue_resolutions`, las etiquetas no se tocan) y promoción a dataset de las filas elegidas con la respuesta correcta que escribe el técnico; detalle de cola en pestañas Summary / Results / Settings, enlace a los datasets que ya contienen cada traza, colas de cada traza en su panel Annotate, botón Annotate por turno en Conversations y Review solo para los revisores de la cola — [ADR-050](adrs/evaluation/adr-050-queue-results-and-curation-for-technical-roles.md)
- [x] Respuesta revisada como expected output en la promoción de colas (`useObservedOutput`, opt-in), Resolve en ventana completa con conversación y "Verdict" / "Correct answer" separados — [ADR-061](adrs/evaluation/adr-061-reviewed-reply-as-expected-output-and-resolve-view.md)
- [x] Acuerdo juez-humano e inter-anotador de solo lectura (kappa de Cohen, matriz de confusión, MAE/Pearson/Spearman, lista de desacuerdos) sobre un run o una cola, en la página del run y en el detalle de la cola — fase D: [ADR-040](adrs/evaluation/adr-040-judge-human-agreement.md). Incluye el muestreo aleatorio reproducible al poblar una cola y la procedencia de cada item (enmienda de [ADR-039](adrs/evaluation/adr-039-annotation-queues.md))
- [x] Promoción de traza a item de dataset desde el detalle de traza ("Add to dataset"): entrada copiada y editable, respuesta correcta escrita por la persona, UNA versión major por llamada, sin duplicados y con la procedencia (`promotedFrom`) protegida en el servidor — fase B: [ADR-038](adrs/datasets/adr-038-promote-trace-to-dataset-item.md). La promoción en lote desde una cola ya está en la UI ([ADR-045](adrs/evaluation/adr-045-evaluation-follow-ups-retrieval-metrics-summaries-retention-and-writer-user.md)) y el test de integración contra Postgres se ha ejecutado
- [x] ADR de la decisión de arquitectura — ver [ADR-028](adrs/evaluation/adr-028-offline-evaluation-decoupled-sdk.md)
- [x] Documentación y ejemplos de integración — `docs-site/library/evaluation.md`, `examples/05_eval_dataset_source_memtrace.py`
- [ ] Fuera de alcance en esta fase: evaluación online (muestreo continuo sobre tráfico de producción)
- [x] Rediseño del dashboard (sistema de diseño "Mediterráneo", navegación de 5 secciones, portada Overview con "Needs attention", vista previa en Conversations, pestañas Conversation/Technical trace, bandeja de Review y Evaluations con comparación de runs) — ver [ADR-048](adrs/ui/adr-048-mediterranean-design-system-and-simplified-navigation.md). Las pantallas siguen consumiendo solo la API de consulta. Incluye título y coste por conversación, aviso de trazas mal valoradas por revisores y la interfaz completa en inglés — ver [ADR-049](adrs/api/adr-049-conversation-title-cost-and-low-rated-traces.md)

- [x] Apariencia ampliada de la organización y modos de visualización del asistente: color secundario, fuente (lista cerrada de pilas del sistema), nombre del asistente y tres modos (burbuja, panel lateral, pantalla completa en pestaña nueva) con modo por defecto/permitidos de la organización y preferencia personal; el chat hereda el tema — [ADR-063](adrs/ui/adr-063-assistant-display-modes-and-extended-theme.md). **Pendiente**: preferencia de modo en el perfil (hoy `localStorage`), avatar y mensaje de bienvenida, presets de tema, paleta de gráficas
- [ ] Registro de asistentes (gobernanza de la IA): **un experimento es un agente** ([ADR-054](adrs/governance/adr-054-experiment-is-an-agent.md): la ficha vive en el experimento, sin paso de registro), ficha por experimento con despliegues DEV/PRE/PRO, estado de `/health`, conexiones (MCP, tools, agentes) declaradas y observadas, y quién puede llamar a cada entorno — [ADR-053](adrs/governance/adr-053-assistant-registry-data-model.md). **Hecho**: modelo de datos (migraciones 021-024), permisos `governance:*` y `assistant:manage`, repositorio, servicio, API de consulta y pantallas del dashboard (catálogo en tarjetas y ficha con Environments y Connections; guía en `docs-site/platform/assistants.md`). worker de sondeo de `/health` (CronJob por minuto, protección SSRF, «Comprobar ahora»). sincronización periódica de las tools observadas (cada 10 min, en el mismo CronJob). **Chat con el agente**: `chat_path` por agente (igual en todos los entornos, el host sale del despliegue) con su contrato JSON, proxy en la API con protección SSRF y panel flotante «Talk» en el dashboard — [ADR-055](adrs/governance/adr-055-agent-chat-endpoint-and-proxy.md). **Servidores MCP observados desde spans**: el SDK marca la tool con `memtrace.mcp_server` (Pydantic AI automático, resto con `attributes=`), la sincronización registra el servidor y enlaza sus tools, y su uso es la suma de las suyas — [ADR-056](adrs/sdk/adr-056-mcp-server-name-on-tool-spans.md). **Pendiente**: agentes remotos observados (`memtrace.peer_agent`)
- [ ] Despliegue desde MemTrace con versión de código en las trazas (**decidido, sin implementar**): MemTrace no despliega, **dispara el CI/CD del repo del agente** (GitHub Actions / GitLab / Bitbucket) y observa el resultado; botón Deploy por entorno, historial `deploy_runs`, y solo se despliega un commit con una evaluación offline exitosa de ese mismo SHA (salida de emergencia auditada para `org_admin`) — [ADR-064](adrs/governance/adr-064-ci-triggered-deployments-with-evaluation-gate.md). El CI inyecta el SHA en el build, el SDK lo lee y lo pone en cada traza y evaluación (`vcs.repository.ref.revision`) — [ADR-065](adrs/observability/adr-065-code-revision-on-traces-and-evaluations.md). **Fase 1 hecha**: `repo_url`/`repo_provider`/`deploy_workflow` por agente y `deploy_ref` por entorno (migración 029, API y dashboard), y el SDK envía `vcs.repository.ref.revision` en cada traza (queda en `ResourceAttributes`). Fases: (1) repo y rama por entorno + atributo de revisión en el SDK; (2a **hecha**: columna `Revision` en ClickHouse (migración 011) con filtro `revision` en trazas, conversaciones y spans; los runs de evaluación guardan el commit y si el árbol estaba sucio (migración Postgres 030); el dashboard enlaza el SHA al commit, filtra por versión y muestra el snippet de CI en la ficha) (2b **hecha**: regla pura `deploy-gate`, servicio de solo lectura y `GET .../assistant/deploy-gate?sha=`; el rollback queda a la espera del historial `deploy_runs` de 2c) (2c **hecha** salvo lo que exige una GitHub App real: puerto `CiDispatcher` + adaptador GitHub App, `deploy_runs` (migración 031), permiso `deploy:run`, `GET/POST .../deploy`, historial, webhook firmado y botón Deploy con modal del gate; faltan GitLab/Bitbucket, aprobaciones en PRO, promoción, botón de rollback y alerta de desviación) conexión GitHub (App), gate, botón Deploy y estado por webhook; (2.5 **hecho salvo el destino de despliegue**, que sigue sin decidir y hace fallar a propósito el último paso del workflow) **Weather assistant como implementación de referencia**: Dockerfile con `GIT_SHA`, workflow de CI que ejecuta sus evaluaciones etiquetadas con el commit, workflow de despliegue con `workflow_dispatch` (`sha`, `environment`) y alta en MemTrace con repo y rama por entorno — [ADR-064](adrs/governance/adr-064-ci-triggered-deployments-with-evaluation-gate.md); (3) GitLab/Bitbucket, aprobaciones en PRO, promoción entre entornos, rollback y alerta de desviación

---

## Fase 1.8: Gestión de Prompts — el prompt como hipótesis con evidencia

**Objetivo**: no un simple versionado de texto, sino un registro donde cada versión lleva medida su calidad, coste y errores, y donde mover un prompt a producción es una decisión respaldada por esa evidencia. Decisión y dirección: [ADR-067](adrs/prompts/adr-067-prompt-registry-immutable-versions-and-tags.md).

- [x] **1. Registro**: el prompt es de la organización y se asocia a uno o varios agentes; versiones inmutables con variables `{{x}}`, tags de entorno (`dev`/`pre`/`pro`, los entornos de la organización) y libres con historial de movimientos, diff entre versiones, archivar en vez de borrar; permisos `prompt:read|write|promote` (migración 032, API, dashboard, `docs-site/platform/prompts.md`)
- [ ] **2. SDK y enlace con trazas**: `prompts.get()` devuelve un *handle* que se resuelve al usarlo (los prompts se cargan en el `lifespan`), refresco en segundo plano del tag, adaptadores LangChain/PydanticAI, atributos `memtrace.prompt.*` en el span (columnas materializadas en ClickHouse) y versión realmente en uso por agente y entorno. Benchmark: `compile()` sin red en la petición
- [ ] **3. Evidencia por versión**: coste, latencia, errores por causa, scores y feedback agregados por (prompt, versión) y diff de comportamiento
- [ ] **4. Promoción con garantías**: política por prompt y entorno (evaluación contra dataset, umbrales, degradación máxima de coste/latencia) con función pura estilo `deploy-gate`; rollback sin reevaluar; bypass auditado
- [ ] **5. Playground contra el asistente real**: reejecutar una traza con otra versión llamando al chat del propio agente (ADR-055) con un override firmado por petición (`baggage`), solo DEV/PRE por defecto; sin clave de proveedor LLM en MemTrace
- [ ] **6. Del fallo al prompt**: propuesta de arreglo desde una traza fallida, validada contra los casos fallidos con el agente real y guardada como borrador para revisión
- [ ] **7. Fragmentos reutilizables** (`{{> tono@pro}}`, fijados a versión exacta al guardar)
- [ ] **8. Mapa de dependencias** (prompt ↔ agentes, datasets, runs, fragmentos) e impacto antes de promover
- Descartado: despliegue progresivo automático (canary con rollback)

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
