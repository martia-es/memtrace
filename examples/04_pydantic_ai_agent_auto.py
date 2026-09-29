import os
import sys
from uuid import uuid4

# Add sdk/python to the path so memtrace can be imported without pip install
sys.path.insert(
    0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "sdk", "python"))
)

from dotenv import load_dotenv
from memtrace import init_tracer, session, shutdown
from memtrace.pydantic_ai import enable_pydantic_ai_instrumentation
from pydantic_ai import Agent

load_dotenv()
init_tracer(service_name="pydantic-ai-agent")

# AUTOMATIC OPTION: enables Pydantic AI auto-instrumentation.
# Uses the tracer configured by init_tracer, with no callbacks or decorators.
enable_pydantic_ai_instrumentation()

agent = Agent(
    "anthropic:claude-haiku-4-5-20251001",
    system_prompt="You are a helpful assistant. Answer in a funny way with emojis",
)


@agent.tool_plain
def search(query: str) -> str:
    """Search for information."""
    return "It's sunny babeeee!!"


conversation_id = str(uuid4())

try:
    # session() groups the spans of both turns under the same conversation
    with session(conversation_id):
        first = agent.run_sync("What's the weather in San Francisco?")
        print(first.output)

        second = agent.run_sync(
            "And what about New York?", message_history=first.all_messages()
        )
        print(second.output)
finally:
    shutdown()
