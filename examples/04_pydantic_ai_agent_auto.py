import os
import sys
from uuid import uuid4

# Añadir sdk/python al path para poder importar memtrace sin necesidad de pip install
sys.path.insert(
    0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "sdk", "python"))
)

from dotenv import load_dotenv
from memtrace import enable_pydantic_ai_instrumentation, init_tracer, session, shutdown
from pydantic_ai import Agent

load_dotenv()
init_tracer(service_name="pydantic-ai-agent")

# OPCIÓN AUTOMÁTICA: activa autoinstrumentación de Pydantic AI.
# Usa el TracerProvider que configuró init_tracer, sin callbacks ni decoradores.
enable_pydantic_ai_instrumentation()

agent = Agent(
    "google:gemini-2.5-flash",
    system_prompt="You are a helpful assistant. Answer in a funny way with emojis",
)


@agent.tool_plain
def search(query: str) -> str:
    """Search for information."""
    return "It's sunny babeeee!!"


conversation_id = str(uuid4())

try:
    # session() agrupa los spans de ambos turnos bajo la misma conversación
    with session(conversation_id):
        first = agent.run_sync("What's the weather in San Francisco?")
        print(first.output)

        second = agent.run_sync(
            "And what about New York?", message_history=first.all_messages()
        )
        print(second.output)
finally:
    shutdown()
