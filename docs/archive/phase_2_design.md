# Fase 2 (Mem): documento de diseño

**Estado**: borrador para discusión. Q1 está resuelta ([ADR-100](../adrs/storage/adr-100-arcadedb-knowledge-store.md): ArcadeDB, opcional y detrás de un puerto, sujeto a una prueba de concepto); el resto no está decidido ni implementado. Cuando una pregunta de la sección 8 se resuelva, se mueve a un ADR (si es difícil de revertir) y se actualiza [roadmap.md](roadmap.md).

Complementa la sección «Fase 2» del roadmap, que describe la visión original (Redis Stack, knowledge graph, feedback loop). Este documento la contrasta con lo que la Fase 1 ya construyó.

---

## 1. Objetivo

Que MemTrace **descubra por sí mismo qué falla de forma recurrente** en un agente y **proponga cambios** que lo corrijan, de modo que el equipo los revise, los evalúe y los promueva con las garantías que ya existen.

Mem no sustituye a la persona que mejora el agente: le entrega candidatos con evidencia, en lugar de que tenga que encontrarlos mirando trazas una a una.

## 2. Principio rector

> **Mem genera candidatos; la Fase 1 los gobierna.**

Todo cambio que Mem quiera aplicar a un agente entra por los mecanismos existentes (borrador de prompt o fragmento → evaluación → aprobación → promoción por entorno). Mem **nunca** inyecta contexto en producción por una vía propia.

Consecuencias:
- No se salta el gate de promoción (ADR-070), las aprobaciones (ADR-076) ni el gate de despliegue (ADR-064).
- El efecto de un aprendizaje se mide con las herramientas actuales (evidencia por versión, ADR-069; ruido, ADR-097), sin construir otra medición.
- Un aprendizaje es siempre reversible: es una versión de prompt, y el rollback ya existe.

## 3. Qué ya existe y qué es nuevo

| Capacidad que pide la Fase 2 | Ya existe (Fase 1) | Es nuevo en Mem |
|---|---|---|
| Agrupar fallos por causa | Resumen de errores de negocio, reglas deterministas por causa, impacto y tendencia (ADR-066) | Agrupar por **similitud** (embeddings, clustering) y por **secuencias de acciones**, no solo por regla |
| Proponer un arreglo | «Del fallo al prompt» y `prompts.propose_fix` a partir de **un** caso (ADR-072) | Proponer a partir de un **patrón** que abarca muchas trazas |
| Inyectar conocimiento en el agente | Prompts versionados, fragmentos `{{> x@pro}}`, borradores (ADR-067, 072, 073) | Decidir **qué** texto se añade y a qué prompt o fragmento |
| Aplicar con garantías | Gate de promoción, aprobaciones, despliegue con gate (ADR-070, 076, 064) | Nada: se reutiliza tal cual |
| Medir si mejora | Evidencia por versión, evaluaciones offline, ruido (ADR-069, 097) | Atribuir la mejora a **un aprendizaje concreto** |
| Relaciones agente/tool/modelo/error/estrategia | Tools y conexiones observadas en el registro de agentes (ADR-053/056) | El **grafo** de relaciones y su consulta |

Lo realmente nuevo es **descubrir patrones entre trazas** y **atribuir resultados a aprendizajes**.

## 4. Alcance

**Dentro**
- Detección de patrones de fallo recurrentes sobre las trazas de un experimento.
- Candidatos de cambio (borrador de prompt o fragmento) con la evidencia que los justifica.
- Métricas de si un aprendizaje aplicado ha servido.
- Conocimiento consultable: «qué sabemos sobre la tool X o el error Y».

**Fuera (de momento)**
- Aplicar cambios automáticamente sin revisión humana.
- Modificar código del agente, tools o configuración de modelos (solo prompts y fragmentos).
- Aprendizaje entre organizaciones o entre clientes de una consultora (ver sección 7).
- Fine-tuning de modelos.

## 5. Arquitectura propuesta

```
ClickHouse (trazas)  ──►  Analizador  ──►  Patrones  ──►  Candidatos  ──►  Flujo Fase 1.8
   (solo lectura)         (job batch)    (almacén N)     (borradores)     (evaluar, aprobar,
                                              │                            promocionar)
                                              ▼
                                      Medición de efecto  ◄── evidencia por versión (ADR-069)
```

Piezas:

1. **Analizador**: job periódico (mismo patrón que los workers existentes: CronJob, evaluador de alertas, `analytics/model_quality`). Lee de ClickHouse con `final = 1` (ADR-099) y respeta la retención y el enmascarado de PII ya aplicados.
2. **Almacén de patrones**: guarda patrones, trazas que los respaldan y relaciones. **Decisión abierta (Q1)**.
3. **Generador de candidatos**: convierte un patrón en un borrador de prompt o fragmento, usando el LLM y la clave del propio equipo, igual que `propose_fix` y los jueces.
4. **Medición**: compara la versión con el aprendizaje frente a la base con las mismas reglas que Compare runs.
5. **API y dashboard**: nuevos endpoints en la API de consulta (pieza 4), con el mismo middleware de autorización. El dashboard solo habla con la API, como siempre.

El stack de la visión original (FastAPI, scikit-learn, Sentence Transformers) encaja como implementación del analizador, pero **no se asume** hasta resolver las preguntas de abajo.

## 6. Fases de entrega propuestas

Cada fase aporta valor por sí sola y se puede parar sin dejar el sistema a medias.

| Fase | Entrega | Valor | Depende de |
|---|---|---|---|
| **2.0** | **Patrones sin IA ni almacén nuevo**: ampliar las reglas de ADR-066 a secuencias de spans (tool X seguida de error Y) y mostrarlos como «patrones recurrentes» en Overview | Útil ya, sin riesgo, y valida qué patrones merecen la pena | — |
| **2.1** | **Similitud**: embeddings de trazas fallidas y clustering; «trazas parecidas» en la página de una traza | Encuentra fallos que las reglas no ven | Q1, Q2 |
| **2.2** | **Candidatos**: de un patrón a un borrador de prompt o fragmento con su evidencia, entrando al flujo de aprobaciones | Cierra el bucle patrón → arreglo | 2.0 o 2.1, ADR-072 |
| **2.3** | **Medición de efecto**: atribuir mejora a un aprendizaje y mostrar su evolución en el tiempo | Responde «¿ha servido?» | 2.2, ADR-097 |
| **2.4** | **Grafo de conocimiento** (si 2.0 a 2.3 demuestran que hace falta) | Consultas multi-salto sobre agente/tool/error/estrategia | Q1 |

El grafo queda el último a propósito: es la parte más cara y la menos probada. Las fases 2.0 a 2.3 pueden funcionar con tablas normales.

## 7. Restricciones transversales

- **PII y retención** (ADR-084): el analizador lee contenido ya enmascarado y los patrones guardados no pueden sobrevivir a la retención del experimento. Un embedding de un texto con PII es también un dato personal.
- **Multi-tenant** (Fase 1.96, ADR-087/093): los patrones pertenecen a un experimento y a su organización. Una consultora no puede aprender de los datos de un cliente para aplicarlos a otro.
- **Permisos**: ver candidatos, aprobarlos y aplicarlos son permisos distintos, con la misma lógica que `prompt:read|write|promote`. Encaja con el modelo de perfiles: el perfil de negocio puede revisar la evidencia, solo `technical` promueve.
- **Coste**: embeddings y generación de candidatos consumen LLM. Deben tener límite por organización, como los jueces y el playground.
- **Salida del sistema**: cada candidato debe poder descartarse y no volver a proponerse.

## 8. Preguntas abiertas

| # | Pregunta | Opciones | Impacto |
|---|---|---|---|
| Q1 | ¿Qué almacén para patrones y, si llega, el grafo? | **Resuelta ([ADR-100](../adrs/storage/adr-100-arcadedb-knowledge-store.md))**: ArcadeDB (Apache 2.0), opt-in y detrás del puerto `KnowledgeStore`; la fase 2.0 no lo necesita. Alternativa si falla la prueba de concepto: Postgres con `pgvector`. Redis Stack, FalkorDB y Neo4j Community descartados | Cerrada |
| Q2 | ¿Dónde se calculan los embeddings? | Modelo local (Sentence Transformers) o proveedor externo | Alto: un proveedor externo envía contenido de trazas a un tercero, lo que toca los «flujos hacia terceros» pendientes en `security-pending.md` |
| Q3 | ¿Cómo entra el conocimiento al agente? | Fragmento versionado en el prompt existente, o prompt propio de «aprendizajes» | Medio. Recomendación: fragmento, para reutilizar ADR-073 y el mapa de dependencias |
| Q4 | ¿Qué es «éxito» o «fallo» de una traza? | **Resuelta para la fase 2.0**: fallo = cualquier span fallido, como hoy (ADR-066). Feedback 👍/👎 y resultados de evaluadores se añaden en fases posteriores | Cerrada para 2.0 |
| Q5 | ¿Quién revisa los candidatos? | Cola de revisión como las de anotación (negocio etiqueta, `technical` promueve), o directamente el flujo de aprobaciones | Medio. Encaja con la regla actual: negocio etiqueta, solo `technical` promueve |
| Q6 | ¿Cómo se atribuye una mejora a un aprendizaje? | Comparar versiones con y sin el fragmento, con repeticiones para medir ruido | Alto para 2.3. Sin atribución fiable, Mem no puede demostrar su valor |
| Q7 | ¿Qué volumen de trazas hace falta para que un patrón sea fiable? | Umbral mínimo como el aviso de muestra pequeña (<30 trazas) de ADR-069 | Medio |
| Q8 | ¿Se aplica algo sin revisión humana alguna vez? | No (recomendado), o solo en `dev` | Alto en confianza; decide si hay modo automático |

## 9. Riesgos

- **Aprender del ruido**: un patrón detectado con pocas trazas o con un fallo transitorio genera candidatos inútiles. Mitigación: umbral mínimo y medición con repeticiones (ADR-097).
- **Prompts que crecen sin control**: acumular «errores a evitar» degrada el prompt. Mitigación: límite de tamaño del fragmento y caducidad de aprendizajes que ya no se disparan.
- **Un tercer almacén sin necesidad**: se evita con la fase 2.0, que no lo requiere, y con el ADR de Q1 antes de construir 2.1.
- **Doble mecanismo**: si Mem inyecta por una vía propia, se pierde la gobernanza. Lo previene el principio de la sección 2.

## 10. Siguientes pasos

1. ~~Resolver Q1~~ (hecho, ADR-100). Q4 queda resuelta para la 2.0. Queda Q2, que condiciona la 2.1, y la prueba de concepto de ArcadeDB antes de la fase 2.1.
2. Confirmar el principio de la sección 2 y actualizar el texto de la Fase 2 en el roadmap para que lo refleje.
3. Definir la fase 2.0: qué patrones de secuencia detectar primero, con datos reales de trazas del weather assistant y el RAG assistant.
4. Añadir los deliverables resultantes a [roadmap.md](roadmap.md) y los pendientes a [backlog.md](backlog.md).
