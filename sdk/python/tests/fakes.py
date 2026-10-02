from contextlib import contextmanager
from typing import Any, Iterable, List, Mapping, Optional

from memtrace.domain.evaluation import EvalItem, ExperimentResult


class FakeHandle:
    def __init__(self, name, attributes, parent):
        self.name, self.parent = name, parent
        self.attributes = dict(attributes)
        self.ended = False
        self.error: Optional[BaseException] = None

    def set_attributes(self, attributes: Mapping[str, Any]) -> None:
        self.attributes.update(attributes)

    def end(self, error=None) -> None:
        self.ended, self.error = True, error


class FakeSpanPort:
    """In-memory outbound port: lets the application be tested without OpenTelemetry."""

    def __init__(self):
        self.spans: List[FakeHandle] = []
        self._current: Optional[FakeHandle] = None
        self.fail = False

    def start_span(self, name, attributes, parent=None):
        if self.fail:
            raise RuntimeError("backend down")
        span = FakeHandle(name, attributes, parent or self._current)
        self.spans.append(span)
        return span

    @contextmanager
    def activate(self, span):
        previous, self._current = self._current, span
        try:
            yield
        finally:
            self._current = previous

    @property
    def tracer_provider(self):
        return None

    def current(self):
        return self._current

    def flush(self, timeout_millis=30000):
        return True

    def shutdown(self):
        pass


class FakeDatasetSource:
    """In-memory `DatasetSource`: lets `run_experiment` be tested without a real backend."""

    def __init__(self, items: Iterable[EvalItem]):
        self._items = list(items)

    def fetch(self) -> Iterable[EvalItem]:
        return list(self._items)


class FakeResultsSink:
    """In-memory `ResultsSink`: records every `ExperimentResult` it receives."""

    def __init__(self):
        self.saved: List[ExperimentResult] = []

    def save(self, result: ExperimentResult) -> None:
        self.saved.append(result)
