"""Simulated multi-step agent: retriever, LLM, tools (one fails) and a session.

Generates varied traces to try the dashboard without any provider API key.
With MEMTRACE_CAPTURE_CONTENT=true prompts, responses and arguments are stored too.

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
def think(question: str, model: str, tokens_in: int, order: dict = None) -> str:
    time.sleep(random.uniform(0.15, 0.45))
    if order is None:
        answer = "Voy a consultar el estado de tu pedido."
    else:
        answer = f"Tu pedido está {order['estado']}."
    messages = [
        {"role": "system", "content": "Eres un asistente de soporte de una tienda online."},
        {"role": "user", "content": question},
    ]
    if order is not None:
        messages.append({"role": "tool", "content": str(order)})

    # With MEMTRACE_CAPTURE_CONTENT=true, these messages feed the dashboard "Transcript" tab
    trace_llm_call(
        provider="openai" if model.startswith("gpt") else "anthropic",
        model=model,
        input_tokens=tokens_in,
        output_tokens=random.randint(40, 220),
        response_model=f"{model}-2026-01",
        finish_reasons=["stop"],
        temperature=0.2,
        max_tokens=1024,
        input_messages=messages,
        output_messages=[{"role": "assistant", "content": answer}],
    )
    return answer


@trace_step(name="atender_consulta", step_type="agent")
def handle(question: str, order_id: str, model: str) -> str:
    retrieve(question)
    think(question, model, tokens_in=random.randint(300, 900))
    try:
        order = lookup_order(order_id)
    except ConnectionError:
        order = {"estado": "en un estado que no puedo consultar ahora mismo"}
    return think(question, model, tokens_in=random.randint(500, 1400), order=order)


if __name__ == "__main__":
    # One conversation = several turns (traces) under the same session id (gen_ai.conversation.id)
    conversations = {
        "cliente-ana": [
            ("¿Dónde está mi pedido?", "A-1001", "gpt-4o"),
            ("¿Cuándo llega?", "A-1013", "gpt-4o"),  # the tool fails
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
                time.sleep(random.uniform(0.3, 1.2))  # the user reads and types
    memtrace.shutdown()
    print("✨ Trazas enviadas: abre el dashboard en http://localhost:5173")
