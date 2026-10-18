# Backlog: cierre de la Fase 1

Documento vivo. Recoge lo que falta y lo que conviene mejorar para que MemTrace sea una buena herramienta de observabilidad y mejora continua **antes de empezar la Fase 2 (Mem)**. Complementa a [roadmap.md](roadmap.md); es la **única** lista de pendientes (sustituye al antiguo `pending-gaps.md`); cuando un punto se cierra, se marca aquí y se actualiza el roadmap.

**Leyenda**: `[ ]` pendiente · `[~]` en curso · `[x]` hecho · Prioridad **A** (alta), **M** (media), **B** (baja) · Esfuerzo **S** (días), **M** (1-2 semanas), **L** (más de 2 semanas)

---

## 1. Lo que falta (funcionalidad nueva)

| # | Estado | Tema | Qué falta | Prioridad | Esfuerzo | Depende de | ADR previsto |
|---|---|---|---|---|---|---|---|
| F1 | [x] | **Alertas** | Hecho ([ADR-086](adrs/observability/adr-086-alerts-and-cost-budgets.md)): reglas sobre tasa de error, latencia p95, coste, satisfacción y gráficas guardadas; email a una lista por regla y campana en la app. Webhooks descartados por ahora | A | M | — | observability |
| F2 | [x] | **Presupuestos de coste** | Hecho (ADR-086): presupuesto mensual por agente con aviso de umbral, superado y previsión a fin de mes | A | S | F1 (reutiliza el motor de reglas) | pricing |
| F4 | [x] | **Retención y PII en trazas** | Hecho ([ADR-084](adrs/storage/adr-084-data-protection-retention-masking-audit-and-export.md)): retención por organización y experimento, y PII enmascarada con `****` en el SDK y en el Collector antes de guardar (los nombres solo los cubre el SDK) | A | M | — | storage / identity |
| F5 | [x] | **Gate de regresión en PR** | Hecho ([ADR-064](adrs/governance/adr-064-ci-triggered-deployments-with-evaluation-gate.md), fase 3): check `memtrace/eval-gate` en el commit evaluado, opt-in por agente y solo GitHub; veredicto absoluto (objetivos de cada evaluador). Pendiente: comparar contra `main` (necesita M4) y abrir el check con el webhook `pull_request` | M | M | Fase 2c de ADR-064 | governance |
| F6 | [x] | **SDK por framework + TypeScript** | Hecho ([ADR-095](adrs/sdk/adr-095-multi-language-sdk-contract.md)): LangGraph, OpenAI Agents SDK (Python) y SDK TypeScript con paridad (trazas, feedback, prompts, evaluación, PII con servicio Presidio, LangChain.js y OpenAI Agents JS), todos contra las mismas escenarios de conformidad. Publicado en npm como `@memtrace-ai/sdk` | M | L | — | sdk |
| F7 | [x] | **Auditoría y exportación** | Hecho (ADR-084): registro de aperturas de contenido, exportaciones y cambios de acceso/configuración, y exportación JSON Lines | M | M | — | identity |
| F9 | [x] | **Gateway de ingesta que valide `service.name`** | Hecho ([ADR-085](adrs/identity/adr-085-ingest-gateway-validates-service-name.md)): cada recurso debe llevar el `service.name` del experimento de la key o la petición se rechaza con 403. Leer la cabecera de una petición de 21 MiB cuesta 0,012 ms | A | M | — | identity |
| F8 | [x] | **Operación en producción** | Backups de ClickHouse/Postgres, despliegue fuera de kind (Helm), pruebas de carga en CI. Hecho: [ADR-096](adrs/infra/adr-096-production-operations-backups-helm-load-gates.md); hecho (1) backups y restauración de Postgres y ClickHouse y (2) chart de Helm en `deploy/helm/memtrace` (guía en `docs-site/platform/operations.md`); y (3) gate de carga (`make load-gate` y workflow nocturno `load-gate.yml`). Pendiente: revisar los umbrales con las primeras ejecuciones en GitHub, y alta disponibilidad (réplicas) que queda fuera de F8 | M | L | — | infra |
| F10 | [~] | **Ingesta resiliente a escala** | Sin estado en los pods de ingesta, varias réplicas y un buffer duradero ([ADR-098](adrs/infra/adr-098-durable-ingestion-pipeline-with-broker.md)): servicio `ingest` aparte de la API de consulta, Prometheus y Grafana, broker (Kafka API) entre dos niveles de Collector y prueba de caos en el gate de carga; después deduplicación con `ReplacingMergeTree` ([ADR-099](adrs/storage/adr-099-deduplicated-span-storage.md)) y autoescalado. Fases en el ADR-098. Hechas las fases 1 a 3: servicio `ingest` aparte con caché de keys que tolera una caída de Postgres, Prometheus y Grafana opcionales (`make monitoring`), y Apache Kafka entre dos Collectors sin estado. Hecha también la deduplicación de spans (ADR-099, `make dedupe`). Pendiente: prueba de caos con 3 nodos y autoescalado | A | L | F8 | infra / storage |

## 2. Pendientes ya anotados en el roadmap

| # | Estado | Tema | Pendiente | Prioridad |
|---|---|---|---|---|
| R1 | [ ] | Despliegues (ADR-064) | GitLab/Bitbucket, aprobaciones en PRO, promoción entre entornos, botón de rollback, alerta de desviación | M |
| R2 | [ ] | Aprobaciones (ADR-076) | Aviso por email a aprobadores, aprobadores por grupo/rol del IdP, reasignar, delegación | M |
| R3 | [ ] | Registro de agentes | Agentes remotos observados (`memtrace.peer_agent`) | B |
| R4 | [ ] | Prompts — evidencia (ADR-069) | Anotaciones humanas, cohortes de tráfico (la serie temporal de errores por versión ya está en Overview › Breakdown) | M |
| R11 | [ ] | Prompts — lista | Columna «Errors 7d» por prompt (tasa de error de la versión en `pro`): requiere devolverla en la lista, hoy solo está en la evidencia de cada prompt | B |
| R5 | [ ] | Prompts — otros | Límites de coste/latencia en la promoción, permiso propio para la política, edición in situ de borradores, fragmentos anidados, límite de ejecuciones del playground | B |
| R6 | [ ] | Apariencia (ADR-063) | Preferencia de modo en el perfil, avatar y bienvenida, presets de tema, paleta de gráficas | B |
| R8 | [ ] | Identidad (ADR-052) | Mapeo de IdP externo (SCIM/grupos) | B |
| R9 | [ ] | Seguridad | Guardrails sobre trazas | B |

## 3. Mejoras sobre lo ya construido

| # | Estado | Área | Mejora | Prioridad | Esfuerzo |
|---|---|---|---|---|---|
| M1 | [x] | Gráficas | Hecho: el Overview muestra los objetivos de error, latencia y coste como semáforo dentro de sus tarjetas, y ofrece activar los de partida. Un objetivo es una regla de alerta o el presupuesto (ADR-086), sin modelo nuevo. Pendiente: valor por defecto de coste, y un selector de ventana distinto de 24 h | M | M |
| M2 | [ ] | Trazas | Búsqueda por contenido (texto de entrada/salida) y comparación de dos trazas lado a lado | M | M |
| M3 | [ ] | Datasets | Importar CSV ya está (soltar el fichero en Datasets); faltan JSONL, `.xlsx`, añadir a un dataset existente y detectar duplicados o casi duplicados. Otras ideas del rediseño: carpetas (`dataset_folders` + `datasets.folder_id`), renombrar y duplicar datasets, columnas extra desde `metadata` | M | S |
| M4 | [x] | Evaluaciones | Medir el ruido de una evaluación y decir si un delta lo supera. Decidido ([ADR-097](adrs/evaluation/adr-097-repeated-executions-to-measure-evaluation-noise.md)): `repeats=N` en `run_experiment` (Python y TypeScript), las ejecuciones se agrupan en un run, y Compare runs muestra «por encima del ruido / dentro del ruido / sin medir». Hecho: `repeats` en los SDK de Python y TypeScript, migración 049 y API (`runGroup`), ruido y veredicto en Compare runs, pestaña Variability y guía en docs-site. Pendiente: que el gate del PR use el veredicto para comparar contra `main` (F5) | M | S |
| M5 | [x] | Costes | Hecho: coste por versión de prompt y por entorno en Overview › Breakdown ([ADR-067](adrs/prompts/adr-067-prompt-registry-immutable-versions-and-tags.md), actualización), por conversación en Conversations, por usuario (`enduser.id`, `user()` en los SDK, migración 016) y la tarjeta «Spend this month» del Summary con la previsión a fin de mes ([ADR-086](adrs/observability/adr-086-alerts-and-cost-budgets.md), actualización). Hecho también sin presupuesto: el evaluador guarda el coste diario de todos los agentes activos (ADR-086, actualización) | M | M |
| M9 | [x] | Costes | Hecho ([ADR-025](adrs/pricing/adr-025-model-pricing-catalog-sync.md), ampliación): columna Quality (Elo de Arena) en Costs › Model pricing, confirmación de coincidencias por organización (`pricing:manage`, perfil `technical`), filtros «In use» y «Needs review» y pestaña Models en la campana; worker `analytics/model_quality`. Pendiente: medir con trazas reales cuántos modelos en uso coinciden, otros tableros de Arena (código, visión), una segunda fuente (Artificial Analysis) y «coste por punto de Elo» | M | M |
| M10 | [x] | Costes | Hecho ([ADR-025](adrs/pricing/adr-025-model-pricing-catalog-sync.md), ampliación): `costOf()` busca primero por nombre exacto y después ignorando prefijo de proveedor y fecha, con la misma normalización que Quality; `gpt-5.2-2025-12-11` usa el precio de `gpt-5.2`. Sufijos como `mini` o `high` no se ignoran | M | S |
| M6 | [ ] | Gobierno | Simplificar u ocultar por defecto «quién puede llamar a cada entorno» si no se usa (ver sección 5) | B | S |
| M8 | [x] | Dashboard | Hecho (ADR-084, actualización): la API acepta hasta 365 días, presets 90 d y 1 y, rango propio de hasta un año; el periodo anterior de Errores respeta la retención efectiva del agente | M | M |
| M7 | [x] | Documentación | Hecho (`docs-site/platform/improvement-cycle.md`): guía «ciclo de mejora en 30 minutos»: traza → fallo → dataset → prompt → eval → deploy | M | S |

## 4. Orden propuesto

| Orden | Bloque | Contenido | Por qué en este orden |
|---|---|---|---|
| 1 | Monitor activo | F1 + F2 | Misma infraestructura; convierte MemTrace de visor en monitor |
| 2 | Confianza de datos | F4 (+ F7) | Es la barrera habitual de adopción en empresa |
| 3 | Ciclo completo | F5 + R1 + R2 | Cierra evaluación → despliegue con garantías |
| 4 | Pulido de producto | M1-M7 | Mejoran lo existente sin riesgo de arquitectura |
| 5 | Adopción y operación | F6 + F8 | Se prioriza si MemTrace sale de uso local |

## 5. Preguntas abiertas

| # | Pregunta | Impacto |
|---|---|---|
| Q1 | ¿MemTrace saldrá de local/kind y lo usarán terceros? Decide la prioridad de F4, F7 y F8 | Alto |
| Q2 | ¿Canal de notificación inicial de F1: solo email o también Slack/webhook? | Medio |
| Q3 | ¿Se mantiene el control de acceso por entorno (DEV/PRE/PRO) del ADR-053, que limita qué agentes o personas pueden llamar a cada entorno? Si nadie lo usa, ver M6 | Bajo |

## 6. Registro de cambios

| Fecha | Cambio |
|---|---|
| 2026-10-10 | Creación del documento a partir de la revisión de la Fase 1 |
| 2026-10-10 | F4 y F7 hechos (ADR-084). Nuevos pendientes: F9 (validar `service.name` en el gateway) y M8 (consultar más de 30 días) |
| 2026-10-10 | F9 hecho (ADR-085) |
| 2026-10-10 | F1 y F2 hechos (ADR-086). Pendiente de este bloque: webhooks para las alertas |
| 2026-10-10 | M8 hecho: el dashboard y la API consultan hasta 365 días |
| 2026-10-10 | Limpieza de documentación: `pending-gaps.md` se fusiona aquí (R8-R10) y este documento pasa a llamarse `backlog.md` |
| 2026-10-10 | F6 hecho: LangGraph, OpenAI Agents SDK y SDK TypeScript (ADR-095) |
| 2026-10-10 | Se descartan F3 (evaluación online), R7 (alertas de satisfacción y satisfacción por versión) y R10 (webhooks y alertas de calidad online); se elimina Q4 |
| 2026-10-11 | F5 hecho (ADR-064, fase 3): check de GitHub con el veredicto de la evaluación |
| 2026-10-11 | M7 hecho: guía «ciclo de mejora en 30 minutos» en docs-site |
| 2026-10-11 | M5 en curso: Overview › Breakdown agrupa por versión de prompt y por entorno, con coste, errores con su margen del 95 % y tendencia |
| 2026-10-12 | F8 en curso: ADR-096 fija backups a S3, chart de Helm y gate de carga a demanda |
| 2026-10-12 | F8: backups nocturnos de Postgres y ClickHouse con `make backup` y `make restore-test` (ADR-096) |
| 2026-10-12 | F8: chart de Helm con comprobación en CI contra Kustomize (ADR-096) |
| 2026-10-12 | M5: coste por usuario en Overview › Breakdown con `enduser.id` (`user()` en los SDK, migración 016) |
| 2026-10-12 | F8 hecho: gate de carga (`load-testing/load_gate.py`, ADR-096) |
| 2026-10-12 | M5 hecho: tarjeta «Spend this month» en Overview › Summary con gasto del mes, previsión a fin de mes y reparto por usuario, versión o entorno |
| 2026-10-12 | M5: «Spend this month» también sin presupuesto; el evaluador mantiene el coste diario de todos los agentes activos |
| 2026-10-12 | M4 decidido (ADR-097): ruido medido con repeticiones desde el SDK en vez de intervalos entre dos runs |
| 2026-10-12 | M4 hecho (ADR-097): ruido y veredicto «por encima / dentro / sin medir» en Compare runs y pestaña Variability |
| 2026-10-17 | Nuevo F10 (ingesta resiliente a escala) con ADR-098 y ADR-099 aceptados y sin implementar |
| 2026-10-17 | F10 fase 1 hecha: servicio `ingest` separado de la API de consulta, con caché de API keys (ADR-098) |
| 2026-10-17 | F10 fase 2 hecha: Prometheus y Grafana opcionales, `/metrics` en `ingest`, 11 reglas de alerta y un dashboard del pipeline (ADR-098) |
| 2026-10-17 | F10 fase 3 hecha: Apache Kafka entre un Collector de entrada y otro de escritura, ambos sin estado; prueba de caídas de ClickHouse, Kafka y pods (ADR-098) |
| 2026-10-17 | F10: deduplicación de spans hecha (ADR-099): `otel_traces` pasa a ReplacingMergeTree sin parar la ingesta; las lecturas usan `final = 1` |
| 2026-10-17 | F10: deduplicación medida con 17,8 M de spans: copia por trozos (antes se quedaba sin memoria), compactación horaria, lecturas con tres ajustes y ClickHouse 24.3 (ADR-099) |
| 2026-10-17 | F10 cerrado en lo técnico: Kafka de 3 nodos sin pérdidas en 6 escenarios, hueco de pérdida del escritor cerrado (`message_marking`), autoescalado por CPU y por lag (ADR-098) |
| 2026-10-18 | Fase 2 (Mem): ADR-100 elige ArcadeDB (Apache 2.0) como almacén de conocimiento, opcional y detrás de un puerto; Redis Stack descartado. Pendiente: prueba de concepto antes de la fase 2.1 |
| 2026-10-18 | Fase 2 (Mem) rediseñada en torno a lecciones que el agente aplica; datos en ClickHouse (derivado) y Postgres (curado); ADR-100 aplazado a la fase 2.4 |
