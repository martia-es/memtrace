"""Records a `Verdict` as a `security.<detector>` span (see ADR-103).

Only detections are recorded by default, to keep traces light. The matched text is never recorded:
just category, severity, action and score.
"""
import contextvars
from contextlib import contextmanager
from typing import Iterator, Optional

from memtrace.application.tracing_service import TracingService
from memtrace.domain.security import Verdict


_in_redteam: contextvars.ContextVar = contextvars.ContextVar("memtrace_in_redteam", default=False)


@contextmanager
def redteam_context() -> Iterator[None]:
    """Detections recorded inside are tagged `security.context=redteam`, so the platform does not count them as production events."""
    token = _in_redteam.set(True)
    try:
        yield
    finally:
        _in_redteam.reset(token)


def record(service: Optional[TracingService], verdict: Verdict, *, only_detections: bool = True) -> None:
    if service is None or (only_detections and not verdict.detected):
        return
    attributes = {
        "security.detected": verdict.detected,
        "security.category": verdict.category,
        "security.severity": verdict.severity,
        "security.action": verdict.action,
        "security.score": verdict.score,
        "security.context": "redteam" if _in_redteam.get() else None,
    }
    name = f"security.{verdict.detector}"
    with service.step(name, name, attributes):
        pass
