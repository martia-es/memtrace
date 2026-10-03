"""Exercises the documented query-API contract with a mocked transport (no real network/server)."""
import json

import httpx
import pytest

from memtrace.adapters.outbound.http.eval_api_client import MemTraceDatasetSource, MemTraceResultsSink
from memtrace.domain.evaluation import EvalItem, EvalItemResult, ExperimentResult, Score


def test_dataset_source_fetches_and_parses_items():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/datasets/ds-1/items"
        return httpx.Response(200, json={"items": [{"input": "2+2?", "expectedOutput": "4", "metadata": {"tag": "math"}}]})

    source = MemTraceDatasetSource("ds-1", base_url="http://memtrace.test", transport=httpx.MockTransport(handler))
    items = list(source.fetch())

    assert items == [EvalItem(input="2+2?", expected_output="4", metadata={"tag": "math"})]


def test_dataset_source_raises_on_http_error():
    transport = httpx.MockTransport(lambda request: httpx.Response(404))
    source = MemTraceDatasetSource("missing", base_url="http://memtrace.test", transport=transport)

    with pytest.raises(httpx.HTTPStatusError):
        list(source.fetch())


class _FakeApi:
    """Records the calls a sink makes against the runs endpoints; can fail the Nth batch."""

    def __init__(self, fail_batches=()):
        self.calls = []
        self.fail_batches = set(fail_batches)
        self._batches = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.read())
        self.calls.append((request.url.path, body))
        if request.url.path.endswith("/items"):
            self._batches += 1
            if self._batches in self.fail_batches:
                return httpx.Response(503)
            return httpx.Response(200, json={"id": "run-1", "status": "running"})
        return httpx.Response(201, json={"id": "run-1", "status": "running"})


def _result(n, version="1.0"):
    items = [
        EvalItemResult(
            item=EvalItem(input=f"q{i}", expected_output="4"),
            output="4",
            trace_id="abc",
            scores=[Score(name="exact_match", value=True, data_type="boolean")],
        )
        for i in range(n)
    ]
    return ExperimentResult(name="my-run", items=items, dataset_version=version)


def _sink(api, **kwargs):
    return MemTraceResultsSink("ds-1", base_url="http://memtrace.test", transport=httpx.MockTransport(api), **kwargs)


def test_save_opens_the_run_with_its_version_then_uploads_and_completes_it():
    api = _FakeApi()
    sink = _sink(api)

    sink.save(_result(1, version="2.1"))

    (open_path, open_body), (items_path, items_body) = api.calls
    assert open_path == "/datasets/ds-1/runs"
    assert open_body == {"name": "my-run", "datasetVersion": "2.1", "complete": False, "items": []}
    assert items_path == "/datasets/ds-1/runs/run-1/items"
    assert items_body["complete"] is True
    item = items_body["items"][0]
    assert item["itemIndex"] == 0
    assert item["expectedOutput"] == "4"
    assert item["traceId"] == "abc"
    assert item["scores"][0] == {"name": "exact_match", "value": "true", "dataType": "boolean", "source": "code", "comment": None, "judgeModel": None, "judgePromptHash": None}
    assert sink.last_run_id == "run-1"


def _shape(call):
    body = call[1]
    return [i["itemIndex"] for i in body["items"]], body["complete"]


def test_items_are_uploaded_in_batches_as_they_arrive_tagged_with_their_index():
    api = _FakeApi()
    sink = _sink(api, batch_size=2)
    sink.start(name="r", dataset_version="1.0")
    result = _result(5)

    for index in (3, 0, 4, 1):  # completion order, not dataset order
        sink.add(index, result.items[index])
    # 4 of 5 items are already uploaded before `finish`: a crash here would lose only the last one
    assert [_shape(c) for c in api.calls[1:]] == [([3, 0], False), ([4, 1], False)]

    sink.add(2, result.items[2])
    sink.finish(result)
    assert _shape(api.calls[-1]) == ([2], True)


def test_a_failed_batch_is_resent_with_the_next_one():
    api = _FakeApi(fail_batches={1})
    sink = _sink(api, batch_size=2)
    sink.start(name="r", dataset_version="1.0")
    result = _result(4)

    for index in (1, 0, 3, 2):
        sink.add(index, result.items[index])  # the first batch hits a 503: must not raise
    sink.finish(result)

    assert [_shape(c) for c in api.calls[1:]] == [([1, 0], False), ([1, 0, 3], False), ([2], True)]


def test_finish_raises_if_results_are_still_unsent():
    api = _FakeApi(fail_batches={1})
    sink = _sink(api, batch_size=10)
    sink.start(name="r", dataset_version="1.0")
    sink.add(0, _result(1).items[0])

    with pytest.raises(httpx.HTTPStatusError):
        sink.finish(_result(1))


def test_a_run_without_a_known_dataset_version_is_refused_instead_of_assuming_latest():
    api = _FakeApi()
    for bad in (None, "sha256:abc123"):
        with pytest.raises(ValueError, match="major.minor"):
            _sink(api).start(name="r", dataset_version=bad)
    assert api.calls == []  # nothing reached the API


def test_explicit_sink_version_wins_over_the_one_reported_by_the_source():
    api = _FakeApi()
    _sink(api, version="3.0").start(name="r", dataset_version="1.0")
    assert api.calls[0][1]["datasetVersion"] == "3.0"


def test_client_requires_a_base_url():
    with pytest.raises(ValueError):
        list(MemTraceDatasetSource("ds-1").fetch())


def test_dataset_source_pins_requested_version():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["query"] = dict(request.url.params)
        return httpx.Response(200, json={"items": []})

    list(MemTraceDatasetSource("ds-1", version="2.1", base_url="http://memtrace.test", transport=httpx.MockTransport(handler)).fetch())
    assert seen["query"] == {"version": "2.1"}


def test_dataset_source_omits_version_by_default():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["query"] = dict(request.url.params)
        return httpx.Response(200, json={"items": []})

    list(MemTraceDatasetSource("ds-1", base_url="http://memtrace.test", transport=httpx.MockTransport(handler)).fetch())
    assert seen["query"] == {}


def test_dataset_source_exposes_the_version_the_server_actually_served():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"items": [], "version": {"id": "v", "major": 2, "minor": 3}})

    source = MemTraceDatasetSource("ds-1", base_url="http://memtrace.test", transport=httpx.MockTransport(handler))
    assert source.version is None
    source.fetch()
    assert source.version == "2.3"
