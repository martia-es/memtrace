import os
import sys
from uuid import uuid4

# Añadir sdk/python al path para poder importar memtrace sin necesidad de pip install
sys.path.insert(
    0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "sdk", "python"))
)

from dotenv import load_dotenv
from memtrace import init_tracer, session, shutdown, trace_step, trace_llm_call

load_dotenv()
init_tracer(service_name="pydantic-ai-test")


@trace_step(name="test_tool", step_type="tool")
def search(query: str) -> str:
    """Search for information."""
    return f"Found results for: {query}"


@trace_step(name="test_agent", step_type="agent")
def run_agent(prompt: str) -> str:
    # Simular una llamada LLM
    result = search(prompt)

    trace_llm_call(
        provider="test",
        model="test-model",
        operation="chat",
        input_tokens=10,
        output_tokens=5,
        input_messages=[{"role": "user", "content": prompt}],
        output_messages=[{"role": "assistant", "content": result}],
    )
    return result


conversation_id = str(uuid4())

try:
    with session(conversation_id):
        print("🚀 Lanzando agente...")
        result = run_agent("What's 2+2?")
        print(f"✅ Resultado: {result}")
finally:
    shutdown()
    print("✨ Spans enviados al OTel Collector")
