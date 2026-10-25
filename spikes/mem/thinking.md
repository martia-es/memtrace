# Mem (Fase 2): qué hemos aprendido del spike y hacia dónde vamos

Notas de trabajo del 2026-10-25. No es un ADR ni una decisión: recoge el razonamiento tras revisar el spike, para no perderlo. Las decisiones que salgan de aquí irán al [diseño de la Fase 2](../../docs/archive/phase_2_design.md), al roadmap y, si procede, a un ADR.

## 1. Contexto

La Fase 2 (Mem) debe convertir los fallos de un agente en lecciones duraderas, aplicarlas para que no se repitan y medir si funcionaron. Antes de construirla, este spike comprueba el diseño con datos sintéticos. Aún no hay código de producto de la Fase 2.

**El spike hoy** (`spikes/mem/`, scripts de Python que leen y escriben ficheros; no usa ninguna base de datos, ni ArcadeDB):

| Script | Qué hace | Tecnología |
|---|---|---|
| `gen_traces.py` | 5.000 trazas falsas de un asistente del tiempo con fallos sembrados (F1 a F7) | Python |
| `episodes.py` | Una fila por traza: pasos, paso decisivo y resultado ponderado (error, bucle, evaluador, 👎/👍) | `pandas` |
| `discover.py` | Agrupa peticiones por tema y busca reglas que separan fallos de éxitos | `sentence-transformers`, `KMeans`, árbol de decisión, test de Fisher |
| `distill.py` | Redacta una lección por causa (plantilla o LLM) y la verifica con otro juicio del LLM | `gemini-2.5-flash` |
| `evaluate.py` | Puntúa contra los fallos sembrados (es el único que lee `ground_truth.json`) | `pandas` |
| `apply.py` | Prueba de efecto con un agente real: sin lección, con lección y control | Gemini |

## 2. Resultados

- **Resultado de la traza:** precisión 0,87 y recall 0,84.
- **Fallos con error visible** (F1, F2, F4): recall de 1,00, 1,00 y 0,99, con reglas de pureza 1,00.
- **Fallos silenciosos** (F3, F5): recall de 0,70 y 0,71. F5 se descubre con pureza 0,55 porque la regla ignora la combinación de idioma y modelo.
- **Ruido (F6):** no genera ninguna lección.
- **Caducidad (F7):** se detecta; el hallazgo de F1 baja de 8,2 a 0,8 por cada 100 trazas con el prompt v2.
- **Lecciones:** 5; cuatro "verificadas" y una (la de varias ciudades) "no verificada" porque estropearía 3 de 5 correctas. La verificación es un juicio de un LLM con 5+5 conversaciones, no una prueba.
- **Prueba de efecto (`apply.py`):** sin concluir. Se paró por un 429 de la cuota de Gemini tras 15 filas, y `apply.py` no reintenta como sí hace `distill.py`. Sin lección, el agente falla en las 8 peticiones de "orden de herramientas", pero con la lección no corrigió las 2 primeras. Con tan pocas filas no se puede concluir nada.

Valoración experta de las 5 lecciones (claridad, corrección, aplicabilidad):

| # | Lección | Notas | Veredicto |
|---|---|---|---|
| 1 | Orden `geocode` antes de `get_forecast` | 5 / 4 / 4 | Buena; el «cuándo» es genérico |
| 2 | Celsius con `idioma=es` | 4 / 3 / 3 | Corrige el síntoma; ignora que el fallo es `es` con `model_b` |
| 3 | No llamar con `city` vacío | 5 / 5 / 4 | La mejor; caduca con el prompt v2 |
| 4 | Una llamada por elemento | 3 / 2 / 2 | No usar; «elemento» es ambiguo |
| 5 | Parar tras 2 reintentos de cuota | 5 / 4 / 3 | El backoff es cosa del código, no del prompt |

## 3. Qué tiene de pobre el enfoque actual

El spike es estadística sobre rasgos que ya conocemos, no entendimiento del agente.

- Los fallos los sembramos nosotros y son sencillos, así que encontrarlos con un árbol casi es trampa: el 0,84 mide si recuperamos lo que pusimos, no si descubrimos algo.
- El árbol solo ve conteos, orden de pasos y atributos. No lee el texto ni sabe si la respuesta era buena.
- El LLM llega tarde: solo redacta una frase con 3+3 ejemplos que el árbol eligió.
- Cada lección es una regla suelta, sin relaciones, causas encadenadas ni memoria entre ejecuciones.
- Con fallos reales (alucinaciones, contexto perdido, razonamiento) estas reglas no verían casi nada.

## 4. Qué hace el mercado

Ninguna herramienta cubre el ciclo completo (aprobación, versionado, medición), pero varias resuelven el descubrimiento mejor que nosotros. Los detalles vienen de búsquedas web y no se han contrastado todos con la documentación oficial.

| Herramienta | Idea que aporta | Notas |
|---|---|---|
| Docent (Transluce) | Un LLM resume, agrupa y busca sobre transcripciones; hipótesis y experimentos contrafactuales | Apache 2.0 según su blog; se autoaloja |
| Kura (reproducción de Clio) | Un LLM resume cada conversación y luego se agrupa por embeddings, de forma jerárquica | Biblioteca Python; mantenimiento sin verificar |
| ACE (ICLR 2026) | Un Generador, un Reflector que extrae lecciones y un Curador que las fusiona en un «playbook» | Es un método, no una herramienta |
| LangSmith Insights | Agrupa trazas con un LLM según una pregunta del usuario | Propietario; referencia de producto |
| Graphiti (Zep) | Grafo de conocimiento temporal: los hechos tienen ventana de validez y se invalidan | Apache 2.0; ver sección 5 |
| failmode | Detección, agrupación y tests de regresión desde trazas OTel | Sin verificar: la URL del repo dio 404 |

Lo común: **un LLM lee cada traza y escribe un diagnóstico antes de agrupar**, y se agrupa por el significado del diagnóstico.

## 5. Graphiti y la base de grafos

**Cubre:** hechos con vigencia, enlace al episodio de origen, relaciones con tipos propios en Pydantic y búsqueda híbrida (semántica, BM25 y grafo).

**No cubre:** descubrir fallos, redactar lecciones, aprobación, aislamiento por organización ni medición. Cada episodio ingerido cuesta llamadas a un LLM, y su servidor MCP es solo de referencia, sin autenticación.

**Base de datos por debajo** (el [ADR-100](../../docs/adrs/storage/adr-100-arcadedb-knowledge-store.md) ya eligió ArcadeDB):

| Opción | Licencia | ¿Graphiti la soporta? | Veredicto |
|---|---|---|---|
| ArcadeDB | Apache 2.0 | No oficial: el PR #1310 lleva abierto desde marzo de 2026, sin revisión de los mantenedores | Mejor encaje de licencia, con riesgo |
| Neo4j Community | GPLv3 | Sí | Descartado en el ADR-100 (clustering y copia en línea de pago) |
| FalkorDB | SSPLv1 | Sí | Descartado por la SSPL §13 |
| Memgraph | BSL 1.1 | Sin driver | No es open source |
| Kuzu | MIT | Obsoleto, se retira | Descartado |

Limitaciones abiertas de ArcadeDB que ha reportado el PR: consultas vectoriales filtradas que devuelven menos filas de las pedidas (coincide con una puerta de la prueba de concepto del ADR-100), etiquetas dinámicas que pueden dejar nodos sin etiqueta y precisión de fechas que baja a milisegundos con índices de rango.

## 6. Cómo se cubre cada paso

El flujo es el de la sección 4 del [diseño](../../docs/archive/phase_2_design.md). Los pasos 3, 4, 5, 7 y 8 cambian para meter un LLM que lee las conversaciones; el resto ya estaba decidido.

| # | Paso | Cómo se cubre | Estado | ¿Grafo? |
|---|---|---|---|---|
| 1 | Trazas | SDK, Collector, Kafka y ClickHouse | Existe | No |
| 2 | Episodio por traza | Worker `analytics/mem` y tabla `mem_episodes` en ClickHouse | Nuevo | No |
| 3 | Resultado | Señales ponderadas; **cambio:** un juez LLM revisa las sospechosas | Cambia | No |
| 4 | Paso decisivo | Span con error más profundo; **cambio:** en silenciosos, el LLM señala el primer paso donde el agente se desvió | Cambia | No |
| 5 | Agrupar | **Cambio:** el LLM diagnostica cada episodio fallido y se agrupan los diagnósticos por significado (embeddings locales, UMAP y HDBSCAN) | Cambia | No |
| 6 | ¿Real o ruido? | Fisher, Wilson y Benjamini-Hochberg contra correctas de la misma intención; soporte mínimo de 30 | Se mantiene | No |
| 7 | Causa raíz | **Cambio:** diagnóstico del LLM sobre la taxonomía MAST adaptada | Cambia | Opcional |
| 8 | Redactar la lección | **Cambio:** Reflector (8 a 10 pares fallo/éxito emparejados) y Curador (fusiona y acota el «cuándo»); clasifica dónde se arregla | Cambia | No |
| 9 | Guardar | Postgres (`lessons`, `lesson_evidence`, `lesson_events`), con versión de prompt y modelo de origen | Nuevo | Opcional |
| 10 | Aprobar | Negocio confirma, `technical` aprueba, permisos `lesson:*`; nada se aplica sin revisión humana | Reutiliza | No |
| 11a | Arreglar ahora | `propose_fix` y el flujo de ADR-072; aquí van las lecciones que no son de prompt | Reutiliza | No |
| 11b | Que no se repita | `memtrace.lessons.get` y `{{lessons}}`, con coincidencia determinista y sello en la traza | Nuevo | No |
| 12 | Medir | Antes: `run_experiment(repeats=N)` con y sin lección. Después: job de reincidencia con control del 10 % y alerta | Reutiliza y amplía | No |
| — | Aislamiento | `org_id` y `experiment_id` en cada fila, un experimento por llamada al LLM, clave de la organización, test de fugas | Transversal | Obligatorio si hay grafo |

## 7. Postura sobre el grafo

**Ningún paso lo necesita.** Solo dos usos son candidatos: causas encadenadas (paso 7) y validez temporal (paso 9). Ambos se pueden probar antes con `networkx` en memoria y con columnas de versión y fecha en Postgres. Si se quedan cortos, se repite la prueba de concepto del ADR-100, con Graphiti sobre ArcadeDB solo si su PR se fusiona. Mientras tanto, el `KnowledgeStore` sigue siendo un puerto y el fallback es Postgres.

## 8. Qué falta decidir

- **Q6:** grupo de control para medir la reincidencia. Propuesta: lección en el 90 % de las peticiones y un 10 % de control los primeros días.
- **Q7:** soporte mínimo de un patrón (30 trazas, a afinar con datos).
- **Q10:** taxonomía de causas para un solo agente (partir de ADR-066 y MAST).
- **Cuánto cuesta** diagnosticar cada episodio fallido con un LLM; hay que medirlo antes de fijar un límite de gasto.

## 9. Siguientes pasos

1. Cerrar `apply.py`: reintento con backoff y pausa entre llamadas, y ejecutar `--n 12` completo.
2. Spike 2: diagnóstico por episodio con LLM y agrupación semántica, sobre trazas reales (RAG o asistente del tiempo).
3. Compararlo con el árbol en dos cosas: qué causas encuentra que el árbol no ve y cuánto corrigen las lecciones en `apply.py`.
4. Con el resultado, actualizar la sección 4 del diseño y el roadmap, y anotar en el ADR-100 la postura sobre el grafo.
