"""Default `DatasetSource`/`ResultsSink` adapters against MemTrace's own query API.

Optional: requires `pip install 'memtrace-ai[eval]'` (httpx). Only touched when the caller of
`memtrace.eval.run_experiment` lets MemTrace resolve a `dataset_id` string for them (see
ADR-027) — passing local data and an explicit `sink` never imports this module.

Contract of the query API (ADR-028, ADR-034; JSON keys are camelCase, like every other endpoint):
    GET  {base_url}/datasets/{dataset_id}/items[?version=major.minor]   (latest version if omitted)
         -> {"items": [{"input": ..., "expectedOutput": ..., "metadata": ...}, ...],
             "version": {"id", "major", "minor"}}      <- the version those items belong to
    POST {base_url}/datasets/{dataset_id}/runs                 (opens a run, `running`)
         -> body {"name": str, "datasetVersion": "major.minor", "complete": false, "items": []}
         -> response {"id": str, "status": "running", ...}
    POST {base_url}/datasets/{dataset_id}/runs/{run_id}/items  (one batch, any order; resending is idempotent)
         -> body {"complete": bool, "items": [{"itemIndex", "input", "expectedOutput", "output",
                                              "traceId", "error", "scores": [...]}]}
"""
import logging
import re
from typing import Any, Dict, Iterable, List, Optional

from memtrace.config import settings
from memtrace.domain.evaluation import EvalItem, EvalItemResult, ExperimentResult, Score

logger = logging.getLogger("memtrace")

_VERSION_RE = re.compile(r"^\d+\.\d+$")


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
    """Fetches a dataset's items from MemTrace's query API by `dataset_id`.

    `version`: a "major.minor" string (e.g. `"2.1"`, as shown in the dashboard) to read that exact
    version; omitted, the latest version at the moment of the call. After `fetch()`, the
    `version` attribute holds the version the server actually served (what `run_experiment`
    records in the result), so a run is never attributed to a version it didn't read.
    """

    def __init__(
        self,
        dataset_id: str,
        *,
        version: Optional[str] = None,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        transport: Optional[Any] = None,
    ):
        """`transport`: overrides the HTTP transport (mainly for tests, e.g. `httpx.MockTransport`)."""
        self._dataset_id = dataset_id
        self.version: Optional[str] = version
        self._requested_version = version
        self._base_url = base_url
        self._api_key = api_key
        self._transport = transport

    def fetch(self) -> Iterable[EvalItem]:
        with _client(self._base_url, self._api_key, self._transport) as client:
            response = client.get(
                f"/datasets/{self._dataset_id}/items",
                params={"version": self._requested_version} if self._requested_version else None,
            )
            response.raise_for_status()
            body = response.json()
        served = body.get("version")
        if served:
            self.version = f"{served['major']}.{served['minor']}"
        return [
            EvalItem(input=row["input"], expected_output=row.get("expectedOutput"), metadata=row.get("metadata"))
            for row in body["items"]
        ]


class MemTraceResultsSink:
    """Uploads an experiment to MemTrace as a `dataset_run` on `dataset_id`, batch by batch while it runs.

    It is an `IncrementalResultsSink`: `start()` opens the run (`running`), every `batch_size`
    finished items are posted — in completion order, each tagged with its dataset position, so a
    slow item never holds back the others — and `finish()` flushes the rest and closes it
    (`completed`). If the process dies midway the run stays `running` with what was already
    uploaded. A failed batch is kept and retried with the next one (the API overwrites by item
    position, so resending is harmless), so a transient outage doesn't lose results; only
    `finish()` raises if something is still unsent.

    A run must say which dataset version it ran against: `version` ("major.minor"), or else the
    version `run_experiment` reports from its source. If neither is known — e.g. local data
    uploaded to a MemTrace dataset — `start()` raises instead of guessing "latest".
    `save(result)` is kept for one-shot use.
    """

    def __init__(
        self,
        dataset_id: str,
        *,
        version: Optional[str] = None,
        batch_size: int = 20,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        transport: Optional[Any] = None,
    ):
        """`transport`: overrides the HTTP transport (mainly for tests, e.g. `httpx.MockTransport`)."""
        self._dataset_id = dataset_id
        self._version = version
        self._batch_size = max(1, batch_size)
        self._base_url = base_url
        self._api_key = api_key
        self._transport = transport
        self.last_run_id: Optional[str] = None
        """Id of the `dataset_run` created by the last run, e.g. to build a dashboard link."""
        self._pending: List[Dict[str, Any]] = []

    def start(self, *, name: str, dataset_version: Optional[str]) -> None:
        version = self._version or dataset_version
        if not version or not _VERSION_RE.match(version):
            raise ValueError(
                f"A MemTrace run must record the dataset version it ran against as 'major.minor'; got {version!r}. "
                "Read the data with data='<dataset_id>' or pass version='2.1' to MemTraceResultsSink."
            )
        self._version = version
        self._pending = []
        body = {"name": name, "datasetVersion": version, "complete": False, "items": []}
        with _client(self._base_url, self._api_key, self._transport) as client:
            response = client.post(f"/datasets/{self._dataset_id}/runs", json=body)
            response.raise_for_status()
            self.last_run_id = response.json().get("id")

    def add(self, index: int, item_result: EvalItemResult) -> None:
        self._pending.append({"itemIndex": index, **_serialize_item(item_result)})
        if len(self._pending) >= self._batch_size:
            try:
                self._flush(complete=False)
            except Exception as exc:  # kept in `_pending`, resent with the next batch
                logger.warning("[MemTrace] uploading a results batch failed, will retry: %s", exc)

    def finish(self, result: ExperimentResult) -> None:
        self._flush(complete=True)

    def save(self, result: ExperimentResult) -> None:
        self.start(name=result.name, dataset_version=result.dataset_version)
        for index, item_result in enumerate(result.items):
            self.add(index, item_result)
        self.finish(result)

    def _flush(self, *, complete: bool) -> None:
        if not self._pending and not complete:
            return
        batch = self._pending[: 1000]  # the API caps a batch at 1000 items
        with _client(self._base_url, self._api_key, self._transport) as client:
            response = client.post(
                f"/datasets/{self._dataset_id}/runs/{self.last_run_id}/items",
                json={"items": batch, "complete": complete and len(batch) == len(self._pending)},
            )
            response.raise_for_status()
        self._pending = self._pending[len(batch):]
        if self._pending:
            self._flush(complete=complete)


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
        "judgeModel": score.judge_model,
        "judgePromptHash": score.judge_prompt_hash,
    }
