"""Agente simulado con varios pasos: retriever, LLM, herramientas (una falla) y sesión.

Genera trazas variadas para probar el dashboard sin necesitar claves de ningún proveedor.
Con MEMTRACE_CAPTURE_CONTENT=true también se guardan prompts, respuestas y argumentos.

    MEMTRACE_CAPTURE_CONTENT=true python examples/02_multi_step_agent.py
"""
import os
import random
import sys
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "sdk", "python")))

import memtrace
from memtrace import session, trace_llm_call, trace_step

memtrace.init_tracer(service_name="asistente-soporte")


@trace_step(name="buscar_documentos", step_type="retriever")
def retrieve(query: str) -> list:
    time.sleep(random.uniform(0.03, 0.09))
    return [f"doc-{i}: contenido relacionado con {query}" for i in range(3)]


@trace_step(name="consultar_pedido", step_type="tool")
def lookup_order(order_id: str) -> dict:
    time.sleep(random.uniform(0.05, 0.15))
    if order_id.endswith("13"):
        raise ConnectionError(f"el servicio de pedidos no responde para {order_id}")
    return {"order_id": order_id, "estado": "enviado"}


@trace_step(name="llm_razonar", step_type="llm")
def think(prompt: str, model: str, tokens_in: int) -> str:
    time.sleep(random.uniform(0.15, 0.45))
    answer = f"Respuesta a: {prompt[:40]}"
    trace_llm_call(
        provider="openai" if model.startswith("gpt") else "anthropic",
        model=model,
        input_tokens=tokens_in,
        output_tokens=random.randint(40, 220),
        response_model=f"{model}-2026-01",
        finish_reasons=["stop"],
        temperature=0.2,
        max_tokens=1024,
        input_messages=[
            {"role": "system", "content": "Eres un asistente de soporte."},
            {"role": "user", "content": prompt},
        ],
        output_messages=[{"role": "assistant", "content": answer}],
    )
    return answer


@trace_step(name="atender_consulta", step_type="agent")
def handle(question: str, order_id: str, model: str) -> str:
    docs = retrieve(question)
    plan = think(f"{question} | contexto: {docs[0]}", model, tokens_in=random.randint(300, 900))
    try:
        order = lookup_order(order_id)
    except ConnectionError:
        order = {"estado": "desconocido"}
    return think(f"{plan} | pedido: {order}", model, tokens_in=random.randint(500, 1400))


if __name__ == "__main__":
    # Una conversación = varios turnos (trazas) bajo el mismo id de sesión (gen_ai.conversation.id)
    conversations = {
        "cliente-ana": [
            ("¿Dónde está mi pedido?", "A-1001", "gpt-4o"),
            ("¿Cuándo llega?", "A-1013", "gpt-4o"),  # la herramienta falla
            ("Gracias, ¿puedo devolverlo?", "A-1001", "gpt-4o"),
        ],
        "cliente-luis": [
            ("Quiero devolver un producto", "A-1002", "claude-sonnet-5"),
            ("Cambiar dirección de envío", "A-1004", "claude-sonnet-5"),
        ],
        "cliente-eva": [("¿Tenéis stock del modelo azul?", "A-1005", "claude-sonnet-5")],
    }
    for conversation_id, turns in conversations.items():
        with session(conversation_id):
            for question, order_id, model in turns:
                handle(question, order_id, model)
                time.sleep(random.uniform(0.3, 1.2))  # el usuario lee y escribe
    memtrace.shutdown()
    print("✨ Trazas enviadas: abre el dashboard en http://localhost:5173")
