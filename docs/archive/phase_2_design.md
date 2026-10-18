# Fase 2 (Mem): documento de diseño

**Estado**: diseño revisado el 2026-10-18 y aceptado en sus líneas generales. Nada está implementado. Las decisiones difíciles de revertir van a ADR cuando se vayan a construir; las preguntas abiertas están en la sección 9. Complementa la sección «Fase 2» de [roadmap.md](../roadmap.md).

---

## 1. Objetivo

> Convertir los fallos de un agente en **lecciones duraderas**, guardarlas a largo plazo por agente, **aplicarlas** para que no se repita el error y **proponer arreglos ahora**, midiendo si funcionaron.

Mem tiene dos salidas:

- **Arreglar ahora**: un borrador de prompt o fragmento con la evidencia que lo justifica.
- **Que no se repita**: una lección aprobada que el agente recibe en ejecución cuando se da la situación.

Mem no sustituye a la persona que mejora el agente: le entrega candidatos con evidencia en vez de obligarle a mirar trazas una a una.

## 2. Principio rector

> **Mem propone; las personas aprueban; la Fase 1 gobierna y mide.**

- Un borrador entra por el flujo existente: evaluar, aprobar y promover por entorno ([ADR-070](../adrs/prompts/adr-070-prompt-promotion-gate.md), [ADR-076](../adrs/governance/adr-076-prompt-approvals.md), [ADR-064](../adrs/governance/adr-064-ci-triggered-deployments-with-evaluation-gate.md)).
- Una lección solo llega al agente si está **aprobada, versionada por entorno y sellada en la traza**, igual que la versión del prompt ([ADR-068](../adrs/prompts/adr-068-prompt-handle-trace-link-and-usage-report.md)). Así su efecto se mide y se apaga sin tocar código.
- Nada se aplica sin revisión humana.

## 3. Cómo se resuelve hoy (resumen de la investigación)

| Enfoque | Qué hace | Lo que tomamos |
|---|---|---|
| Reflexion y ExpeL | Reflexión tras fallar; ExpeL compara trayectorias buenas y malas y extrae reglas | Contrastar éxito y fallo de la misma intención |
| Capas de memoria (Mem0, Zep/Graphiti, Letta, LangMem) | Memoria persistente; Graphiti invalida hechos contradichos | Validez temporal de una lección |
| Observabilidad (LangSmith Insights y Engine, Braintrust Topics, Arize Signal) | Clusters de trazas; Engine propone un PR | Agrupar y proponer; falta ciclo de vida y medición |
| GEPA / DSPy | Evoluciona prompts reflexionando sobre trazas | Valida la vía «sugerir mejora» |
| MAST | Taxonomía de 14 modos de fallo | Taxonomía de causas, no clusters libres |

Riesgos documentados: una reflexión incorrecta que persiste puede ser grave, y la memoria puede envenenarse si contenido de un atacante entra en ella. El hueco que nadie cubre bien es el ciclo con gobierno y medición, que la Fase 1 ya tiene.

## 4. Flujo

| # | Paso | Herramienta y dónde corre | Estado |
|---|---|---|---|
| 1 | El agente genera trazas | SDK → Collector → Kafka → ClickHouse (`otel_traces`) | Existe |
| 2 | **Episodio** por traza: objetivo, pasos ordenados, resultado | Worker Python `analytics/mem` (CronJob), `clickhouse-connect`; tabla `mem_episodes` en ClickHouse, como `span_topics` ([ADR-022](../adrs/observability/adr-022-topic-extraction-bertopic.md)) | Nuevo |
| 3 | **Resultado** (fallo, sospechoso, ok) con motivos y confianza | Reglas en Python sobre: span en error, guardrail, feedback ([ADR-062](../adrs/observability/adr-062-end-user-feedback-on-traces.md)), evaluadores, anotaciones, bucles de reintento, usuario que repite la pregunta | Señales existen, combinador nuevo |
| 4 | **Paso decisivo** donde se rompe | Span fallido más profundo (lógica de ADR-066); en fallos silenciosos, el paso con peor puntuación | Reutiliza |
| 5 | **Agrupar** episodios fallidos | Embeddings con `sentence-transformers` (modelo local de ADR-022), UMAP + HDBSCAN, n-gramas de secuencias de tools con `pandas` | Parcial |
| 6 | **¿Real o ruido?** | `scipy` y `statsmodels`: Fisher, intervalos de Wilson, Benjamini-Hochberg, contra trazas exitosas de la misma intención; soporte mínimo de 30 trazas | Nuevo |
| 7 | **Causa raíz** | Catálogo de ADR-066 más nombre del cluster con c-TF-IDF de BERTopic; sin LLM | Reutiliza |
| 8 | **Redactar la lección** | En el lado del usuario: `memtrace.mem.distill(cluster, llm=...)`, mismo patrón que `propose_fix`; salida JSON validada con `pydantic` | Patrón existe |
| 9 | **Guardar** | Postgres: `lessons`, `lesson_evidence`, `lesson_events`. API con un `LessonRepository` | Nuevo |
| 10 | **Revisar y aprobar** | Cola de anotación (negocio confirma, `technical` aprueba) y reglas de aprobación de ADR-076 | Reutiliza |
| 11a | **Arreglar ahora** | «Crear borrador» llama a `propose_fix` con varios casos (ya los acepta) y sigue el flujo de ADR-072 | Reutiliza |
| 11b | **Que no se repita** | SDK `memtrace.lessons.get(...)` devuelve lecciones aprobadas; el agente las incluye con la variable `{{lessons}}` del prompt | Nuevo |
| 12 | **Medir** | Antes: dataset desde la evidencia y `run_experiment(repeats=N)` con y sin lección ([ADR-097](../adrs/evaluation/adr-097-repeated-executions-to-measure-evaluation-noise.md)). Después: job de reincidencia y alerta ([ADR-086](../adrs/observability/adr-086-alerts-and-cost-budgets.md)) | Reutiliza |

### Aplicar una lección en ejecución (11b)

- La coincidencia es **determinista**: nombre de la tool, categoría de error o intención. No se calculan embeddings en cada petición.
- Se devuelven como máximo N lecciones dentro de un presupuesto de tokens.
- La traza guarda los ids de las lecciones aplicadas.

### Estados de una lección

propuesta → revisada → aprobada → activa → obsoleta → retirada. Se invalida si cambia el modelo o el prompt, o si deja de dispararse. Cada candidato puede descartarse y no volver a proponerse.

## 5. Dónde vive cada dato

> **Lo que se calcula a partir de las trazas vive en ClickHouse. Lo que decide una persona vive en Postgres.**

```
ClickHouse (derivado, recalculable)           Postgres (curado, fuente de verdad)
  trazas                                        lecciones y su estado
  episodios y resultado de cada traza           evidencia (ids de trazas)
  embeddings y clusters                         aprobaciones y auditoría
```

- No se añade ningún almacén: son los dos de la Fase 1.
- Si se pierde ClickHouse se recalculan episodios y clusters; las decisiones humanas están en Postgres, con copias ([ADR-096](../adrs/infra/adr-096-production-operations-backups-helm-load-gates.md)).
- Los embeddings caducan con la retención de la traza de origen ([ADR-084](../adrs/storage/adr-084-data-protection-retention-masking-audit-and-export.md)).
- A esta escala (decenas de miles de episodios fallidos) la distancia coseno se calcula en ClickHouse sin índice vectorial.
- **ArcadeDB queda aplazado** hasta el grafo de relaciones (fase 2.4): [ADR-100](../adrs/storage/adr-100-arcadedb-knowledge-store.md).

## 6. Dónde corre el LLM

MemTrace no guarda claves de proveedores. La redacción de lecciones (paso 8) corre **en el lado del usuario**, con su clave, igual que `propose_fix` y los jueces. El servidor hace solo lo que no necesita LLM (pasos 2 a 7). Una opción en que el servidor guarde la clave, para que un botón lo haga solo, queda como mejora posterior y es una frontera de seguridad nueva (ver `security-pending.md`).

## 7. Fases de entrega

Cada fase aporta valor por sí sola y se puede parar sin dejar el sistema a medias.

| Fase | Entrega | Qué ve el usuario |
|---|---|---|
| **2.0 Observar** | Episodios, resultado multi-señal, paso decisivo y patrones deterministas (bucles, qué precede al fallo) | «Patrones recurrentes» en Overview |
| **2.1 Descubrir** | Clusters, contraste éxito/fallo, causa raíz con taxonomía | Fallos agrupados con ejemplos |
| **2.2 Destilar** | Lecciones con ciclo de vida y borrador de arreglo | Pantalla *Learning* y «crear borrador» |
| **2.3 Aplicar** | Lecciones en ejecución con `{{lessons}}` y sello en la traza | El agente deja de repetir el error |
| **2.4 Medir y conectar** | Repetición contrafactual, reincidencia y, si hace falta, el grafo | Impacto de cada lección |

La pantalla *Learning* es un cambio importante de interfaz: antes de construirla se presenta una propuesta en el artefacto de diseño del proyecto.

## 8. Restricciones transversales

- **PII y retención**: el analizador lee contenido ya enmascarado. Una lección es texto generado y nunca copia contenido de usuario.
- **Multi-tenant** ([ADR-088](../adrs/cybersecurity/adr-088-strict-tenant-isolation-in-clickhouse.md), [ADR-091](../adrs/cybersecurity/adr-091-client-boundary-for-multi-client-organizations.md)): las lecciones pertenecen a un experimento y a su organización; una consultora no aprende de un cliente para aplicarlo a otro.
- **Permisos**: `lesson:read`, `lesson:review` y `lesson:approve`, con la lógica de `prompt:read|write|promote`.
- **Coste**: la redacción consume LLM del usuario, con límite configurable.
- **Seguridad de la memoria**: aprobación humana siempre, límite de tamaño de lo que se inyecta y caducidad de lecciones que ya no se disparan.

## 9. Preguntas abiertas

| # | Pregunta | Estado |
|---|---|---|
| Q1 | Almacén | Resuelta: ClickHouse (derivado) y Postgres (curado); ArcadeDB solo para el grafo ([ADR-100](../adrs/storage/adr-100-arcadedb-knowledge-store.md)) |
| Q2 | Dónde se calculan los embeddings | Resuelta: modelo local, como ADR-022; nada sale a terceros |
| Q3 | Cómo entra el conocimiento al agente | Resuelta: variable `{{lessons}}` en el prompt, más borradores por el flujo existente |
| Q4 | Qué es éxito o fallo | **Reabierta**: resultado multi-señal. Falta fijar pesos y umbrales en la fase 2.0 |
| Q5 | Quién revisa | Resuelta: cola de anotación; negocio confirma, `technical` aprueba |
| Q6 | Cómo se atribuye una mejora | Repetición contrafactual con ruido medido; el diseño del job de reincidencia (grupo de control) queda para la 2.4 |
| Q7 | Soporte mínimo de un patrón | Propuesta: 30 trazas, como ADR-069; se afinará con datos |
| Q8 | ¿Se aplica algo sin revisión humana? | No |
| Q9 | Forma exacta de `memtrace.lessons.get` y de `{{lessons}}` | Abierta; irá a un ADR de SDK antes de la 2.3 |
| Q10 | Taxonomía de causas para un solo agente | Abierta; partir de ADR-066 y adaptar MAST |

## 10. Riesgos

- **Aprender del ruido**: umbral mínimo, tests estadísticos y repetición con ruido medido.
- **Memoria envenenada o reflexión incorrecta**: aprobación humana, texto generado y no copiado, sello en la traza y apagado por lección.
- **Prompts que crecen sin control**: presupuesto de tokens y caducidad.
- **Datos de pruebas pobres**: los datos locales de desarrollo son pocos y con pocos tipos de fallo; la validación necesita trazas generadas con fallos variados.
- **Dependencia del modelo**: una lección se invalida si cambia el modelo.

## 11. Siguientes pasos

1. Fijar la definición de resultado multi-señal (Q4) y el esquema de `mem_episodes`.
2. Construir la fase 2.0 con trazas sintéticas con fallos variados, sin depender de datos reales.
3. ADR de las lecciones (modelo de datos, estados y permisos) antes de la 2.2.
4. ADR del SDK de lecciones (Q9) antes de la 2.3.
5. Propuesta de interfaz de *Learning* antes de la 2.2.
