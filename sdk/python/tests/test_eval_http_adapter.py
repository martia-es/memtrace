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


def test_results_sink_posts_serialized_result():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["body"] = request.read()
        return httpx.Response(201, json={"id": "run-1", "name": "my-run", "itemCount": 1, "createdAt": "2026-09-30T00:00:00Z"})

    sink = MemTraceResultsSink("ds-1", base_url="http://memtrace.test", transport=httpx.MockTransport(handler))
    result = ExperimentResult(
        name="my-run",
        items=[
            EvalItemResult(
                item=EvalItem(input="2+2?", expected_output="4"),
                output="4",
                trace_id="abc",
                scores=[Score(name="exact_match", value=True, data_type="boolean")],
            )
        ],
    )

    sink.save(result)

    assert captured["path"] == "/datasets/ds-1/runs"
    body = json.loads(captured["body"])
    assert body["name"] == "my-run"
    item = body["items"][0]
    assert item["expectedOutput"] == "4"
    assert item["traceId"] == "abc"
    assert item["scores"][0] == {"name": "exact_match", "value": "true", "dataType": "boolean", "source": "code", "comment": None}
    assert sink.last_run_id == "run-1"


def test_client_requires_a_base_url():
    with pytest.raises(ValueError):
        list(MemTraceDatasetSource("ds-1").fetch())
