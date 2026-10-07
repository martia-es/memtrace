"""HTTP adapter for end-user feedback (👍/👎) against MemTrace's own query API (ADR-062).

Optional: requires `pip install 'memtrace-ai[eval]'` (httpx), like the other HTTP adapters.

Contract (JSON keys are camelCase, like every other endpoint; the agent's API key is the credential):
    POST   {base_url}/traces/{trace_id}/feedback
           body {"rating": 1 | -1, "comment"?, "spanId"?, "endUserId"?, "externalMessageId"?}  -> 201
    DELETE {base_url}/traces/{trace_id}/feedback[?endUserId=&spanId=]                          -> 204
"""
from typing import Any, Dict, Optional

from memtrace.adapters.outbound.http.eval_api_client import _client


def post_feedback(
    trace_id: str,
    rating: int,
    *,
    comment: Optional[str] = None,
    span_id: Optional[str] = None,
    end_user_id: Optional[str] = None,
    external_message_id: Optional[str] = None,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    transport: Optional[Any] = None,
) -> None:
    body: Dict[str, Any] = {"rating": rating}
    optional = {"comment": comment, "spanId": span_id, "endUserId": end_user_id, "externalMessageId": external_message_id}
    body.update({key: value for key, value in optional.items() if value is not None})
    with _client(base_url, api_key, transport) as client:
        client.post(f"/traces/{trace_id}/feedback", json=body).raise_for_status()


def delete_feedback(
    trace_id: str,
    *,
    span_id: Optional[str] = None,
    end_user_id: Optional[str] = None,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    transport: Optional[Any] = None,
) -> None:
    params = {key: value for key, value in {"spanId": span_id, "endUserId": end_user_id}.items() if value is not None}
    with _client(base_url, api_key, transport) as client:
        client.delete(f"/traces/{trace_id}/feedback", params=params).raise_for_status()
