"""Records a `Verdict` as a `security.<detector>` span (see ADR-103).

Only detections are recorded by default, to keep traces light. The matched text is never recorded:
just category, severity, action and score.
"""
from typing import Optional

from memtrace.application.tracing_service import TracingService
from memtrace.domain.security import Verdict


def record(service: Optional[TracingService], verdict: Verdict, *, only_detections: bool = True) -> None:
    if service is None or (only_detections and not verdict.detected):
        return
    attributes = {
        "security.detected": verdict.detected,
        "security.category": verdict.category,
        "security.severity": verdict.severity,
        "security.action": verdict.action,
        "security.score": verdict.score,
    }
    name = f"security.{verdict.detector}"
    with service.step(name, name, attributes):
        pass
