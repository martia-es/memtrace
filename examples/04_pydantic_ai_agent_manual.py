import os
import sys
from uuid import uuid4

# Añadir sdk/python al path para poder importar memtrace sin necesidad de pip install
sys.path.insert(
    0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "sdk", "python"))
)

from dotenv import load_dotenv
from memtrace import init_tracer, session, shutdown, trace_llm_call, trace_step
from pydantic_ai import Agent

load_dotenv()
init_tracer(service_name="pydantic-ai-agent")

# OPCIÓN MANUAL: sin Agent.instrument_all(); controlas qué se instrumenta
# con los decoradores de MemTrace.
agent = Agent(
    "google:gemini-2.5-flash",
    system_prompt="You are a helpful assistant. Be concise and accurate.",
)


@agent.tool_plain
@trace_step(name="search", step_type="tool")
def search(query: str) -> str:
    """Search for information."""
    return f"Results for: {query}"


@trace_step(name="pydantic_ai_agent", step_type="agent")
def ask(prompt: str) -> str:
    result = agent.run_sync(prompt)
    usage = result.usage()

    trace_llm_call(
        provider="google",
        model="gemini-2.5-flash",
        operation="chat",
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        input_messages=[{"role": "user", "content": prompt}],
        output_messages=[{"role": "assistant", "content": result.output}],
    )
    return result.output


conversation_id = str(uuid4())

try:
    with session(conversation_id):
        print(ask("What's the weather in San Francisco?"))
finally:
    shutdown()
