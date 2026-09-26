import time
import uuid

import pytest

from memtrace.application.tracing_service import TracingService
from memtrace.domain.model import CapturePolicy, LlmCall
from tests.fakes import FakeSpanPort


@pytest.fixture
def port():
    return FakeSpanPort()


@pytest.fixture
def service(port):
    return TracingService(port, CapturePolicy(enabled=True), span_ttl_seconds=60)


def test_parent_resolution_run_then_current_then_root(service, port):
    parent = service.start_run("parent")
    child = service.start_run("child", parent_run_id=parent)
    assert port.spans[1].parent is port.spans[0]

    with service.step("block"):
        service.start_run("inside")  # sin parent_run_id: cuelga del span actual
    assert port.spans[3].parent is port.spans[2]

    service.start_run("orphan", parent_run_id=uuid.uuid4())  # padre desconocido: raíz
    assert port.spans[4].parent is None
    service.end_run(child)


def test_step_closes_span_with_error_and_restores_state(service, port):
    with pytest.raises(KeyboardInterrupt):
        with service.step("s"):
            raise KeyboardInterrupt()
    assert isinstance(port.spans[0].error, KeyboardInterrupt)
    assert port.current() is None and service.active_runs == 0


def test_backend_failure_never_reaches_user_code(service, port):
    port.fail = True
    with service.step("s") as run_id:
        assert run_id is None  # el bloque se ejecuta igual
    assert service.start_run("x") is None
    service.end_run(uuid.uuid4())


def test_user_exception_propagates_untouched_when_backend_is_down(service, port):
    port.fail = True
    with pytest.raises(ValueError):
        with service.step("s"):
            raise ValueError("del usuario")


def test_expire_stale_ends_orphans(service, port):
    service.start_run("orphan")
    service.expire_stale(now=time.time() + 3600)
    assert port.spans[0].ended and port.spans[0].attributes["memtrace.span.expired"] is True
    assert service.active_runs == 0


def test_record_llm_call_on_current_span_and_capture_gating(port):
    off = TracingService(port, CapturePolicy(enabled=False))
    with off.step("llm", "llm"):
        off.record_llm_call(LlmCall(provider="openai", model="gpt-4o"), input_messages=[{"role": "user", "content": "x"}])
    assert port.spans[0].attributes.get("gen_ai.input.messages") is None
    assert port.spans[0].attributes["gen_ai.request.model"] == "gpt-4o"


def test_none_attribute_does_not_override_active_session(service, port):
    from memtrace import session

    with session("conv-1"):
        service.start_run("a", attributes={"gen_ai.conversation.id": None})
        service.start_run("b", attributes={"gen_ai.conversation.id": "explicit"})
    assert port.spans[0].attributes["gen_ai.conversation.id"] == "conv-1"
    assert port.spans[1].attributes["gen_ai.conversation.id"] == "explicit"
