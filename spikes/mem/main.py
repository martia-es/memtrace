"""Orquesta el spike de Mem de principio a fin y explica qué hace cada paso.

Uso:
    uv run python main.py                 # los 5 pasos
    uv run python main.py --sin-llm       # todo menos redactar lecciones (no necesita clave)
    uv run python main.py --desde 3       # empieza en el paso 3 (reutiliza lo ya generado)

Cada paso es un script independiente; este fichero solo los lanza en orden.
Lo que un paso produce es lo que el siguiente lee:

    1 gen_traces ──> data/*.jsonl ──> 2 episodes ──> out/episodes.pkl ──> 3 discover
    ──> out/findings.json ──> 4 distill ──> out/lessons_for_review.md        5 evaluate (solo comprueba)
"""
import argparse
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent

# (número, script, qué hace, qué equivale en MemTrace)
PASOS = [
    (1, "gen_traces.py",
     "Crea 5000 conversaciones FALSAS de un asistente del tiempo y les mete 6 fallos a propósito (F1..F6),\n"
     "    más un poco de ruido. Es el sustituto de las trazas reales de un usuario.",
     "En producción esto no existe: las trazas llegan del SDK a ClickHouse."),
    (2, "episodes.py",
     "Agrupa los spans de cada conversación en un 'episodio' y decide si salió bien, mal o dudosa\n"
     "    combinando señales: errores, bucles de reintentos, evaluaciones y pulgares arriba/abajo.",
     "Fase 2.0 (Observar): tabla mem_episodes con el resultado multi-señal."),
    (3, "discover.py",
     "Calcula características automáticas de cada episodio (herramientas usadas, nº de pasos, modelo, idioma,\n"
     "    tipo de petición) y busca condiciones que expliquen muchos fallos, validadas con tests estadísticos.\n"
     "    No sabe qué fallos se sembraron. Produce 'hallazgos' (reglas), todavía sin redactar.",
     "Fase 2.1 (Descubrir): clustering y minería de contrastes."),
    (4, "distill.py",
     "Agrupa los fallos por lo que ocurrió (paso + error) y redacta una lección por grupo: con una PLANTILLA si el\n"
     "    patrón es estructural (argumento vacío, orden de herramientas, reintentos...) o con un LLM (Gemini) que lee\n"
     "    conversaciones completas, fallidas y correctas. Luego verifica cada lección con conversaciones que no usó.",
     "Fase 2.2 (Destilar): el worker de Mem; el LLM usa la clave guardada (ADR-101)."),
    (5, "evaluate.py",
     "Compara lo descubierto con los fallos que se sembraron en el paso 1 y dice qué encontró y qué no.\n"
     "    Es el ÚNICO script que conoce la solución; los demás nunca la ven. Solo sirve para medir el spike.",
     "No existe en producción: ahí no hay solución conocida, de ahí que las lecciones las valore una persona."),
]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--desde", type=int, default=1, help="primer paso a ejecutar (1-5)")
    ap.add_argument("--sin-llm", action="store_true", help="salta el paso 4 (no llama a ningún LLM)")
    args = ap.parse_args()

    for num, script, que_hace, en_memtrace in PASOS:
        if num < args.desde:
            continue
        if num == 4 and args.sin_llm:
            print(f"\n=== Paso {num}: {script} — SALTADO (--sin-llm)")
            continue
        print(f"\n{'=' * 78}\nPaso {num}: {script}\n  Qué hace: {que_hace}\n  En MemTrace: {en_memtrace}\n{'-' * 78}", flush=True)
        r = subprocess.run([sys.executable, str(HERE / script)], cwd=HERE)
        if r.returncode != 0:
            sys.exit(f"\nEl paso {num} ({script}) falló con código {r.returncode}; no sigo.")

    print("\nListo. Si ejecutaste el paso 4, valora las lecciones en out/lessons_for_review.md")


if __name__ == "__main__":
    main()
