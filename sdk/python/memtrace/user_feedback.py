"""End-user feedback: send a 👍/👎 about an agent's answer and link it to the trace that produced it (ADR-062).

The trace id is the key (the same one the dashboard shows), so the agent only has to hand it to its UI
(`current_trace_id()` while answering) and give it back when the person votes (`feedback(...)`)::

    with trace_step_context("conversation_turn", step_type="chain"):
        reply = run_agent(message)
        trace_id = memtrace.current_trace_id()      # return it with the reply

    memtrace.feedback(trace_id, "up")                # later, when the person clicks 👍

Needs `pip install 'memtrace-ai[eval]'`, `MEMTRACE_API_URL` (with the experiment id) and `MEMTRACE_API_KEY`.
"""
import logging
from typing import Any, Optional, Union

from memtrace.dependency_container import active_service

logger = logging.getLogger("memtrace")

Rating = Union[int, str]
_RATINGS = {"up": 1, "down": -1, 1: 1, -1: -1}


def current_trace_id() -> Optional[str]:
    """Trace id of the span being executed, to return it to the caller together with the answer.

    `None` when there is no active span or tracing is off (nothing to link a vote to).
    """
    service = active_service()
    return service.current_trace_id() if service is not None else None


def feedback(
    trace_id: str,
    rating: Rating,
    *,
    comment: Optional[str] = None,
    span_id: Optional[str] = None,
    end_user_id: Optional[str] = None,
    external_message_id: Optional[str] = None,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    transport: Optional[Any] = None,
) -> None:
    """Records (or changes) an end user's vote on the answer of `trace_id`.

    `rating`: `"up"` / `1` or `"down"` / `-1`. `end_user_id` is a pseudonym you choose: the same person voting
    again on the same answer *replaces* their vote; without it the vote is anonymous (one per trace).
    `span_id` rates one step instead of the whole answer. `external_message_id` is your own message id, kept
    as metadata. Raises `httpx.HTTPStatusError` if MemTrace rejects it (unknown trace, bad rating).
    """
    from memtrace.adapters.outbound.http.feedback_client import post_feedback

    if rating not in _RATINGS:
        raise ValueError("rating must be 'up', 'down', 1 or -1")
    post_feedback(
        trace_id,
        _RATINGS[rating],
        comment=comment,
        span_id=span_id,
        end_user_id=end_user_id,
        external_message_id=external_message_id,
        base_url=base_url,
        api_key=api_key,
        transport=transport,
    )


def retract_feedback(
    trace_id: str,
    *,
    span_id: Optional[str] = None,
    end_user_id: Optional[str] = None,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    transport: Optional[Any] = None,
) -> None:
    """Withdraws an end user's vote (the one for `end_user_id`, or the anonymous one). Idempotent."""
    from memtrace.adapters.outbound.http.feedback_client import delete_feedback

    delete_feedback(trace_id, span_id=span_id, end_user_id=end_user_id, base_url=base_url, api_key=api_key, transport=transport)
