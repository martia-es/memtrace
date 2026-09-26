import asyncio
import time
import os
import sys

# Añadir sdk/python al path para poder importar memtrace sin necesidad de pip install
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "sdk", "python")))

from memtrace import init_tracer, shutdown, trace_llm_call, trace_step

# 1. Inicializar MemTrace pointing to local OTel collector
init_tracer(service_name="agente-investigador-python")


@trace_step(name="Buscar_En_Base_De_Datos", step_type="tool")
def search_tool(query: str) -> str:
    print(f"🔍 [Tool] Buscando datos para: '{query}'...")
    time.sleep(0.1)  # Simular latencia de red
    return f"Resultado de búsqueda para: '{query}'"


@trace_step(name="Analizar_Con_LLM", step_type="llm")
def llm_call_step(prompt: str, context_data: str) -> str:
    print("🤖 [LLM] Generando respuesta con GPT-4o...")
    response_text = f"Respuesta procesada sobre: {context_data}"

    # Registrar atributos de llamada GenAI
    trace_llm_call(
        provider="openai",
        model="gpt-4o",
        operation="chat",
        input_tokens=180,
        output_tokens=52,
        input_messages=[{"role": "user", "content": prompt}],
        output_messages=[{"role": "assistant", "content": response_text}],
    )
    return response_text


@trace_step(name="Ejecutar_Agente_Principal", step_type="agent")
async def run_agent(query: str):
    print(f"🚀 Iniciando ejecución del Agente con consulta: '{query}'")

    # Paso 1: Usar la herramienta
    data = search_tool(query)

    # Paso 2: Llamar al LLM
    final_result = llm_call_step(query, data)

    print(f"✅ Agente completado con éxito: {final_result}")
    return final_result


if __name__ == "__main__":
    asyncio.run(run_agent("¿Qué es MemTrace y cómo funciona en Kubernetes?"))

    # Asegurar que todos los spans en el buffer se envían al Collector
    shutdown()
    print("✨ Spans vaciados correctamente al OTel Collector.")
