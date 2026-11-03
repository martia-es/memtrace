# Spike 2: grafo de entidades y pasos a partir de los spans

**Pregunta**: ¿se pueden construir, solo con los spans de MemTrace, un grafo (episodio, pasos, herramientas, ciudades, intención, señales) y encontrar en él patrones que expliquen los fallos de un agente? Separado de [`spikes/mem`](../mem/README.md), que probó la clasificación de causas con un LLM.

**Datos**: las 190 trazas (160 conversaciones) que `spikes/mem` generó contra una copia del weather assistant. Sin etiqueta de éxito o fallo.

## Capas

| Capa | Cómo | Fichero |
|---|---|---|
| 1. Estructura | Episodio, pasos LLM y de herramienta, herramienta, argumento, modelo, error: se leen de `ParentSpanId`, `memtrace.step_type` y `gen_ai.tool.*`. Sin LLM | `build_graph.py` |
| 2. Texto libre | Un LLM lee cada mensaje: qué pide y qué cosas concretas nombra (entidades de cualquier tipo). Cada mensaje se convierte en una plantilla (las entidades se sustituyen por su tipo: «¿Va a llover en <ciudad>?»); un LLM agrupa las plantillas en 5-10 categorías con nombre y definición (`intents.py`), los embeddings completan lo que se le escape y un segundo modelo mide si la agrupación es robusta. Cada herramienta recibe un nombre corto leído de su descripción. Todo con caché | `build_graph.py`, `llm.py` |
| 3. Señales genéricas | Responde sin consultar, la consulta da error, repite la consulta, ignora algo que pidió el usuario, consulta un dato que el usuario no dio, bloqueado. Un LLM solo decide si dos textos nombran lo mismo («Londres» y «London») | `build_graph.py` |

**Nada está escrito a mano para un agente concreto** (ni ciudades, ni palabras clave, ni nombres); el vocabulario de las señales y los textos del visor son los de MemTrace y valen para cualquier agente.

## Uso

```bash
cd spikes/mem-graph
python export_traces.py            # spans de ClickHouse (cluster local) -> data/spans.jsonl
GROQ_API_KEY=... uv run python build_graph.py   # grafo -> out/graph.json (~190 llamadas al LLM, en caché)
uv run python visualize.py         # visor -> out/graph.html (vis-network desde cdnjs)
open out/graph.html                # abrir un episodio: out/graph.html#ep=<id>
```

Vistas: **Agregado** (intenciones, herramientas y señales; tamaño y grosor = nº de episodios; clic en un nodo o arista lista sus episodios) y **Episodio** (el grafo de una traza).

## Lo que se vio

- El grafo sale solo: 10 categorías de petición, 45 entidades y 3 herramientas con nombre, sin nada escrito a mano.
- Agrupar las peticiones fue el punto más delicado. Probado y descartado: (a) pedir al LLM que agrupe frases-resumen (solapaba categorías); (b) agrupar esas frases por embeddings (el resumen «consultar el clima» dejaba 168 de 190 en un solo grupo); (c) agrupar las plantillas por embeddings (mezclaba «Compara…» con «¿Qué tiempo hace…?»). Lo que mejor funciona es que un LLM vea las ~43 plantillas a la vez.
- Dos modelos distintos coinciden en la agrupación con ARI 0,57 (moderado): quedan categorías vecinas («Consulta temperatura actual» y «Calor actual»; «Pronóstico lluvia» y «Pronóstico general»).
- Las señales son pistas, no veredictos: de 41 «responde sin consultar nada», casi todas son correctas (saludos, falta la ciudad, fechas imposibles).
- Se pierde el aviso de «ignora la unidad pedida» (pedir Kelvin y recibir °C): era específico del weather. Cubrirlo de forma genérica exige un juez LLM que compare lo pedido con la respuesta.
- Sin etiqueta de éxito no hay minería de patrones discriminantes; eso es lo siguiente.
