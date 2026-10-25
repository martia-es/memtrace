# Spike: Mem (Fase 2)

**Pregunta**: ¿podemos descubrir, a partir de trazas, qué falla de forma recurrente en un agente, redactarlo como lección y comprobar que aplicarla reduce el fallo? Diseño que se pone a prueba: [docs/archive/phase_2_design.md](../../docs/archive/phase_2_design.md).

**Truco del spike**: los datos son sintéticos y los fallos están **sembrados** con frecuencia conocida (`data/ground_truth.json`), así que se puede medir si el pipeline los encuentra. El pipeline nunca lee ese fichero; solo lo usa `evaluate.py` para puntuar.

## Estructura

| Fichero | Qué hace |
|---|---|
| `gen_traces.py` | Genera ~5.000 trazas con la forma de `otel_traces`, feedback y puntuaciones de evaluador |
| `data/` | Salida del generador y descargas públicas en `data/raw/` (no se versiona) |
| `bench_data/` | Conversores de datasets públicos al formato común de episodio (`out/datasets/`). Hoy: Exgentic v2 (`python -m bench_data.exgentic download\|build`) |

## Fallos sembrados

| Id | Fallo | Qué comprueba |
|---|---|---|
| F1 | Pregunta sin ciudad → `get_forecast(city="")` falla | Caso fácil, span en error |
| F2 | Bucle de reintentos tras un 429 | Patrón de secuencia |
| F3 | Compara dos ciudades pero consulta solo una; sin error, solo 👎 / evaluador | Fallo silencioso |
| F4 | Llama a `get_forecast` antes que a `geocode` | Orden de pasos |
| F5 | Solo falla con idioma `es` **y** modelo `model_b` (unidades mal), sin error | Confusores |
| F6 | Fallos transitorios aleatorios | Ruido: no debe ser lección |
| F7 | F1 baja a la mitad del periodo porque el prompt v2 pide la ciudad | Caducidad de la lección |

## Uso

```bash
python3 gen_traces.py --traces 5000 --seed 7
```
