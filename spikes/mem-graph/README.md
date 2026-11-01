# Spike 2: grafo de entidades y pasos a partir de los spans

**Pregunta**: ¿se pueden construir, solo con los spans de MemTrace, un grafo (episodio, pasos, herramientas, ciudades, intención, señales) y encontrar en él patrones que expliquen los fallos de un agente? Separado de [`spikes/mem`](../mem/README.md), que probó la clasificación de causas con un LLM.

**Datos**: las 190 trazas (160 conversaciones) que `spikes/mem` generó contra una copia del weather assistant. Sin etiqueta de éxito o fallo.

## Capas

| Capa | Cómo | Fichero |
|---|---|---|
| 1. Estructura | Episodio, pasos LLM y de herramienta, herramienta, argumento, modelo, error: se leen de `ParentSpanId`, `memtrace.step_type` y `gen_ai.tool.*`. Sin LLM | `build_graph.py` |
| 2. Texto libre | Intención, ciudad, idioma y unidad del mensaje del usuario. Aquí con reglas; es el hueco donde iría un LLM ligero | `build_graph.py` |
| 3. Señales | Comprobaciones que cruzan texto y estructura (`refused_without_tool`, `unit_ignored`, `compare_partial`, `tool_result_error`...) | `build_graph.py` |

## Uso

```bash
cd spikes/mem-graph
python export_traces.py            # spans de ClickHouse (cluster local) -> data/spans.jsonl
uv run python build_graph.py       # grafo -> out/graph.json
uv run python visualize.py         # visor -> out/graph.html (vis-network desde cdnjs)
open out/graph.html                # abrir un episodio: out/graph.html#ep=<id>
```

Vistas: **Agregado** (intenciones, herramientas y señales; tamaño y grosor = nº de episodios; clic en un nodo o arista lista sus episodios) y **Episodio** (el grafo de una traza).

## Lo que se vio

- Las señales deterministas son pistas, no veredictos. Los primeros 8 «respondió sin herramienta» eran rechazos correctos (fechas imposibles) y `Londres`/`London` contaba como dos ciudades: hizo falta una señal de rechazo y resolver alias de entidades.
- Señales que sí apuntaban a fallos reales del agente: `unit_ignored` (pide Kelvin y responde en °C) y `tool_result_error` (ciudad inexistente).
- Sin etiqueta de éxito no hay minería de patrones discriminantes; eso es lo siguiente.
