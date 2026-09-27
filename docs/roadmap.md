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
- **3 roles en total, en 2 niveles distintos:**
  - `org_admin` (nivel organización): tiene admin implícito sobre **todos** los experimentos de su organización, sin necesitar membership explícita en cada uno. Puede crear experimentos nuevos dentro de la organización e invitar usuarios (como `org_admin`, o directamente a un experimento como `admin`/`member`).
  - `admin` (nivel experimento): igual que `member`, más invitar a otros usuarios a ese experimento concreto (como `admin` o `member`). No tiene visibilidad sobre otros experimentos de la organización salvo que se le invite a ellos también.
  - `member` (nivel experimento): solo lectura sobre ese experimento (trazas, dashboard, métricas).
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
- Esta fase requiere su propio ADR, dado que introduce una decisión de arquitectura importante: un segundo almacén de datos (PostgreSQL) además de ClickHouse. Ver [ADR-013](adrs/adr-013-identity-postgres-and-oauth-rbac.md).

### Deliverables Fase 1.5

- [x] Decisión de modelo de roles: multi-tenant, `org_admin` (organización) + `admin`/`member` (experimento)
- [x] Registrar apps OAuth en Google Cloud Console y Microsoft Entra ID
- [ ] Login con Google (OIDC) funcionando en el dashboard
- [ ] Login con Microsoft/Azure AD (OIDC) funcionando en el dashboard
- [ ] Almacén de identidad (PostgreSQL) con esquema de organizaciones / usuarios / experimentos / membership de organización (usuario, organización, `org_admin`) / membership de experimento (usuario, experimento, rol) / sesiones
- [ ] Creación de organización: cualquier usuario autenticado puede crear una y pasa a ser su primer `org_admin`
- [ ] Creación de experimento: solo un `org_admin` de la organización puede crear experimentos dentro de ella
- [x] Flujo de invitación a organización: un `org_admin` invita a otro usuario como `org_admin` de esa organización
- [x] Flujo de invitación a experimento: un `admin` (o `org_admin`) invita a otro usuario como `admin`/`member` de ese experimento
- [ ] Middleware de autorización en la API de consulta aplicado a todos los endpoints existentes de Fase 1, evaluando `org_admin` OR membership de experimento
- [ ] Autenticación por API key para agentes en el OTel Collector
- [x] ADR de la decisión de arquitectura (segundo almacén + estrategia de auth) — [ADR-013](adrs/adr-013-identity-postgres-and-oauth-rbac.md)
- [ ] Documentación de cómo dar de alta un usuario/agente nuevo

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
