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
        service.start_run("inside")  # no parent_run_id: hangs from the current span
    assert port.spans[3].parent is port.spans[2]

    service.start_run("orphan", parent_run_id=uuid.uuid4())  # unknown parent: root
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
        assert run_id is None  # the block runs anyway
    assert service.start_run("x") is None
    service.end_run(uuid.uuid4())


def test_user_exception_propagates_untouched_when_backend_is_down(service, port):
    port.fail = True
    with pytest.raises(ValueError):
        with service.step("s"):
            raise ValueError("from the user")


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


def test_capacity_evicts_oldest_run_and_flags_it(port):
    svc = TracingService(port, span_ttl_seconds=0, max_active_runs=2)
    svc.start_run("a")
    svc.start_run("b")
    svc.start_run("c")  # over capacity: "a" is closed early
    assert svc.active_runs == 2
    assert port.spans[0].ended and port.spans[0].attributes["memtrace.span.expired"] is True
    assert not port.spans[1].ended


def test_reaper_expires_orphans_without_new_traffic(port):
    svc = TracingService(port, span_ttl_seconds=0.2)
    svc.start_run("orphan")
    deadline = time.time() + 5
    while svc.active_runs and time.time() < deadline:
        time.sleep(0.05)
    assert svc.active_runs == 0 and port.spans[0].ended
    svc.shutdown()


def test_reaper_stops_on_shutdown(port):
    svc = TracingService(port, span_ttl_seconds=60)
    svc.start_run("x")
    thread = svc._reaper
    assert thread is not None and thread.is_alive()
    svc.shutdown()
    thread.join(timeout=2)
    assert not thread.is_alive()
