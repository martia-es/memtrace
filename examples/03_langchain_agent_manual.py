import os
import sys
from uuid import uuid4

# Añadir sdk/python al path para poder importar memtrace sin necesidad de pip install
sys.path.insert(
    0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "sdk", "python"))
)

from dotenv import load_dotenv
from langchain.agents import create_agent
from langchain.tools import tool
from memtrace import MemTraceCallbackHandler, init_tracer, session, shutdown

load_dotenv()
init_tracer(service_name="langchain-agent")


@tool
def search(query: str) -> str:
    """Search for information."""
    return f"Results for: {query}"


agent = create_agent(
    model="google_genai:gemini-2.5-flash",
    tools=[search],
    system_prompt="You are a helpful assistant. Be concise and accurate.",
)

conversation_id = str(uuid4())
config = {
    "configurable": {"thread_id": conversation_id},
    "callbacks": [MemTraceCallbackHandler()],
    "metadata": {
        "thread_id": conversation_id,
    },
}

# OPCIÓN 1: Manual — controlas qué cadenas instrumentar
# (recomendado para librerías profesionales)
try:
    with session(conversation_id):
        result = agent.invoke(
            {
                "messages": [
                    {"role": "user", "content": "What's the weather in San Francisco?"}
                ]
            },
            config=config,
        )
        print(result)
finally:
    shutdown()
