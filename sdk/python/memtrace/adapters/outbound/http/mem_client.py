"""HTTP adapter that reads Mem's findings from MemTrace's query API (phase 2.2).

Optional: requires `pip install 'memtrace-ai[eval]'` (httpx). `base_url` is the experiment's
(`.../api/v1/experiments/<id>`); the agent's API key is the credential.

    GET  {base_url}/mem/patterns?from=&to=  -> 200 {"runAt", "episodes", "failed", "unexplained", "goalClusters", "findings": [...]}
    POST {base_url}/lessons  body {title, guidance, match, situation, failure, message, findingId, evidenceTraceIds, originMetrics}
         -> 201 {"lesson": {"id", "status", ...}, "current": {...}, "environments": []}   (ADR-104; 409 if the finding already has a lesson)
"""
from typing import Any, Dict, List, Optional

from memtrace.domain.lesson import Finding, Lesson


class MemSourceError(Exception):
    """MemTrace could not be reached or refused the request."""


class HttpMemClient:
    def __init__(self, base_url: str, api_key: Optional[str], *, timeout: float = 10.0, transport: Optional[Any] = None) -> None:
        try:
            import httpx
        except ImportError as exc:
            raise ImportError("Reading Mem findings requires: pip install 'memtrace-ai[eval]'") from exc
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        self._client = httpx.Client(base_url=base_url, headers=headers, timeout=timeout, transport=transport)

    def findings(self, *, since: Optional[str] = None, until: Optional[str] = None) -> List[Finding]:
        params: Dict[str, Any] = {k: v for k, v in (("from", since), ("to", until)) if v}
        try:
            response = self._client.get("/mem/patterns", params=params)
        except Exception as exc:
            raise MemSourceError(f"{type(exc).__name__}: {exc}") from exc
        if response.status_code >= 400:
            raise MemSourceError(f"MemTrace answered {response.status_code}")
        return [Finding.from_api(item) for item in response.json().get("findings", [])]

    def save_lesson(self, lesson: Lesson) -> Dict[str, Any]:
        """Proposes `lesson` in MemTrace: it starts as `proposed` and a person reviews and approves it."""
        body = {
            "title": lesson.title,
            "guidance": lesson.guidance,
            "situation": lesson.situation,
            "failure": lesson.failure,
            "match": {key: list(values) for key, values in lesson.match.items()},
            "message": lesson.rationale,
            "findingId": lesson.finding_id,
            "evidenceTraceIds": list(lesson.evidence_trace_ids),
            "originMetrics": dict(lesson.origin_metrics),
        }
        try:
            response = self._client.post("/lessons", json=body)
        except Exception as exc:
            raise MemSourceError(f"{type(exc).__name__}: {exc}") from exc
        if response.status_code == 409:
            raise MemSourceError("MemTrace already has a lesson for this finding (it may have been dismissed)")
        if response.status_code >= 400:
            detail = ""
            try:
                detail = str(response.json().get("detail") or "")
            except Exception:
                pass
            raise MemSourceError(f"MemTrace answered {response.status_code}: {detail}")
        return dict(response.json())

    def close(self) -> None:
        self._client.close()
