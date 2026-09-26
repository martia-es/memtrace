import os
import sys
from uuid import uuid4

# Añadir sdk/python al path para poder importar memtrace sin necesidad de pip install
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "sdk", "python")))

from langchain.agents import create_agent
from langchain.tools import tool
from memtrace import init_tracer, shutdown, MemTraceCallbackHandler
from dotenv import load_dotenv

load_dotenv()
init_tracer(service_name="langchain-agent")


@tool
def search(query: str) -> str:
    """Search for information."""
    return f"Results for: {query}"


agent = create_agent(
    model="google_genai:gemini-3.6-flash",
    tools=[search],
    system_prompt="You are a helpful assistant. Be concise and accurate.",
)

config = {"configurable": {"thread_id": str(uuid4())}}

# OPCIÓN 1: Manual — controlas qué cadenas instrumentar
# (recomendado para librerías profesionales)
result = agent.invoke(
    {"messages": [{"role": "user", "content": "What's the weather in San Francisco?"}]},
    config=config,
    callbacks=[MemTraceCallbackHandler()],  # LLM, herramientas y cadena se capturan automáticamente
)

# OPCIÓN 2: Automática (requiere: pip install memtrace[otel-langchain])
# Descomenta para activar autoinstrumentación en TODO:
# from memtrace import enable_langchain_instrumentation
# enable_langchain_instrumentation()
# result = agent.invoke({...}, config=config)  # Sin callbacks

print(result)
shutdown()
