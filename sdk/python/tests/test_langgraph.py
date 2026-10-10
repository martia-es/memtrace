"""A real LangGraph graph traced through MemTraceCallbackHandler (the unit tests in test_langchain.py use synthetic runs)."""
from typing import TypedDict

import pytest

pytest.importorskip("langgraph")
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel  # noqa: E402
from langchain_core.messages import AIMessage  # noqa: E402
from langgraph.checkpoint.memory import MemorySaver  # noqa: E402
from langgraph.graph import END, START, StateGraph  # noqa: E402

from memtrace.langchain import MemTraceCallbackHandler  # noqa: E402


class State(TypedDict):
    question: str
    answer: str


def _memtrace_spans(exporter):
    """Only the handler's spans: an auto-instrumentor enabled by an earlier test stays on for the whole process."""
    return {s.name: s for s in exporter.get_finished_spans() if s.instrumentation_scope.name == "memtrace"}


def _run(thread_id="T1"):
    llm = GenericFakeChatModel(messages=iter([AIMessage(content="hi")]))
    graph = StateGraph(State)
    graph.add_node("agent", lambda s: {"answer": llm.invoke(s["question"]).content})
    graph.add_node("post", lambda s: {"answer": s["answer"].upper()})
    graph.add_edge(START, "agent")
    graph.add_edge("agent", "post")
    graph.add_edge("post", END)
    app = graph.compile(checkpointer=MemorySaver())
    app.invoke({"question": "x"}, config={"callbacks": [MemTraceCallbackHandler()], "configurable": {"thread_id": thread_id}})


def test_nodes_become_steps_of_the_graph_run(spans):
    _run()
    finished = _memtrace_spans(spans)
    root, agent, post = finished["LangGraph"], finished["agent"], finished["post"]
    assert agent.parent.span_id == root.context.span_id and post.parent.span_id == root.context.span_id
    llm = next(s for s in finished.values() if s.attributes["memtrace.step_type"] == "llm")
    assert llm.parent.span_id == agent.context.span_id


def test_every_span_is_langgraph_and_thread_id_is_the_session(spans):
    _run("T9")
    for span in _memtrace_spans(spans).values():
        assert span.attributes["memtrace.framework"] == "langgraph"
        assert span.attributes["gen_ai.conversation.id"] == "T9"
