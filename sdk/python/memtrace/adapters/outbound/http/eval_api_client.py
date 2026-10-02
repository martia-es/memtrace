"""Default `DatasetSource`/`ResultsSink` adapters against MemTrace's own query API.

Optional: requires `pip install 'memtrace-ai[eval]'` (httpx). Only touched when the caller of
`memtrace.eval.run_experiment` lets MemTrace resolve a `dataset_id` string for them (see
ADR-027) — passing local data and an explicit `sink` never imports this module.

Contract of the query API (ADR-028; JSON keys are camelCase, matching every other endpoint):
    GET  {base_url}/datasets/{dataset_id}/items
         -> {"items": [{"input": ..., "expectedOutput": ..., "metadata": ...}, ...]}
    POST {base_url}/datasets/{dataset_id}/runs
         -> body {"name": str, "items": [{"input", "expectedOutput", "output",
                                            "traceId", "error", "scores": [...]}]}
         -> response {"id": str, "name": str, "itemCount": int, "createdAt": str}
"""
from typing import Any, Dict, Iterable, Optional

from memtrace.config import settings
from memtrace.domain.evaluation import EvalItem, EvalItemResult, ExperimentResult, Score


def _client(base_url: Optional[str], api_key: Optional[str], transport: Optional[Any] = None) -> Any:
    try:
        import httpx
    except ImportError as exc:
        raise ImportError("Talking to the MemTrace API requires: pip install 'memtrace-ai[eval]'") from exc

    url = base_url or settings.api_url
    if not url:
        raise ValueError("No MemTrace API URL configured; pass base_url= or set MEMTRACE_API_URL")
    key = api_key if api_key is not None else settings.api_key
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    return httpx.Client(base_url=url, headers=headers, timeout=30.0, transport=transport)


class MemTraceDatasetSource:
    """Fetches a dataset's items from MemTrace's query API by `dataset_id`."""

    def __init__(
        self,
        dataset_id: str,
        *,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        transport: Optional[Any] = None,
    ):
        """`transport`: overrides the HTTP transport (mainly for tests, e.g. `httpx.MockTransport`)."""
        self._dataset_id = dataset_id
        self._base_url = base_url
        self._api_key = api_key
        self._transport = transport

    def fetch(self) -> Iterable[EvalItem]:
        with _client(self._base_url, self._api_key, self._transport) as client:
            response = client.get(f"/datasets/{self._dataset_id}/items")
            response.raise_for_status()
            for row in response.json()["items"]:
                yield EvalItem(
                    input=row["input"],
                    expected_output=row.get("expectedOutput"),
                    metadata=row.get("metadata"),
                )


class MemTraceResultsSink:
    """Uploads a finished `ExperimentResult` as a `dataset_run` on `dataset_id`."""

    def __init__(
        self,
        dataset_id: str,
        *,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        transport: Optional[Any] = None,
    ):
        """`transport`: overrides the HTTP transport (mainly for tests, e.g. `httpx.MockTransport`)."""
        self._dataset_id = dataset_id
        self._base_url = base_url
        self._api_key = api_key
        self._transport = transport
        self.last_run_id: Optional[str] = None
        """Id of the `dataset_run` created by the last `save()` call, e.g. to build a dashboard link."""

    def save(self, result: ExperimentResult) -> None:
        with _client(self._base_url, self._api_key, self._transport) as client:
            response = client.post(
                f"/datasets/{self._dataset_id}/runs",
                json={"name": result.name, "items": [_serialize_item(r) for r in result.items]},
            )
            response.raise_for_status()
            self.last_run_id = response.json().get("id")


def _serialize_item(result: EvalItemResult) -> Dict[str, Any]:
    return {
        "input": result.item.input,
        "expectedOutput": result.item.expected_output,
        "output": result.output,
        "traceId": result.trace_id,
        "error": result.error,
        "scores": [_serialize_score(s) for s in result.scores],
    }


def _serialize_score(score: Score) -> Dict[str, Any]:
    value = score.value
    # the API stores `value` as a string (ClickHouse `scores.Value`); booleans serialize
    # lowercase so they round-trip with `"true"`/`"false"`, not Python's `str(True) == "True"`.
    if isinstance(value, bool):
        value = "true" if value else "false"
    else:
        value = str(value)
    return {
        "name": score.name,
        "value": value,
        "dataType": score.data_type,
        "source": score.source,
        "comment": score.comment,
    }
