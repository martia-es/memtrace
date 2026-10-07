"""Exercises the end-user feedback contract with a mocked transport (no real network/server)."""
import json

import httpx
import pytest

import memtrace
from memtrace.user_feedback import current_trace_id


class _Recorder:
    def __init__(self, status=201):
        self.requests = []
        self.status = status

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(self.status, json={})


def _send(recorder, rating, **kwargs):
    memtrace.feedback("t" * 32, rating, base_url="http://memtrace.test/api/v1/experiments/e1", api_key="mtk_x", transport=httpx.MockTransport(recorder), **kwargs)


def test_posts_the_vote_to_the_trace_with_the_agent_api_key():
    recorder = _Recorder()
    _send(recorder, "up", end_user_id="u-9", comment="great", external_message_id="msg-1")

    (request,) = recorder.requests
    assert request.method == "POST"
    assert request.url.path == f"/api/v1/experiments/e1/traces/{'t' * 32}/feedback"
    assert request.headers["authorization"] == "Bearer mtk_x"
    assert json.loads(request.content) == {"rating": 1, "comment": "great", "endUserId": "u-9", "externalMessageId": "msg-1"}


def test_accepts_words_and_numbers_and_omits_unset_fields():
    recorder = _Recorder()
    _send(recorder, "down")
    _send(recorder, -1)
    assert [json.loads(r.content) for r in recorder.requests] == [{"rating": -1}, {"rating": -1}]


def test_rejects_an_unknown_rating_before_calling_the_api():
    recorder = _Recorder()
    with pytest.raises(ValueError):
        _send(recorder, "meh")
    assert recorder.requests == []


def test_surfaces_http_errors():
    with pytest.raises(httpx.HTTPStatusError):
        _send(_Recorder(status=404), "up")


def test_retract_sends_a_delete_with_the_end_user():
    recorder = _Recorder(status=204)
    memtrace.retract_feedback("t" * 32, end_user_id="u-9", base_url="http://memtrace.test/api/v1/experiments/e1", transport=httpx.MockTransport(recorder))
    (request,) = recorder.requests
    assert request.method == "DELETE" and request.url.params["endUserId"] == "u-9"


def test_current_trace_id_is_none_without_an_active_tracer():
    assert current_trace_id() is None
