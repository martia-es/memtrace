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
from langchain_core.messages import HumanMessage
from memtrace import (
    MemTraceCallbackHandler,
    enable_langchain_instrumentation,
    init_tracer,
)

load_dotenv()
# service_name / endpoint / headers vienen del .env (los genera el dashboard al crear la API key
# de un experimento, ADR-013) en vez de hardcodearse aquí.
init_tracer()


@tool
def search(query: str) -> str:
    """Search for information."""
    return "It's sunny babeeee!!"


agent = create_agent(
    model="google_genai:gemini-2.5-flash",
    tools=[search],
    system_prompt="You are a helpful assistant. Answer in a funny way with emojis",
)

conversation_id = str(uuid4())
config = {
    "configurable": {"thread_id": conversation_id},
    "callbacks": [MemTraceCallbackHandler()],
    "metadata": {
        "thread_id": conversation_id,
    },
}

enable_langchain_instrumentation()
initial_state = agent.invoke(
    {"messages": [{"role": "user", "content": "What's the weather in San Francisco?"}]},
    config=config,
)
messages = initial_state["messages"]

final_messages = agent.invoke(
    {"messages": messages + [HumanMessage(content="And what about New York?")]},
    config=config,
)

print(final_messages)
