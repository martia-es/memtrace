"""El 👍/👎 del usuario se reenvía a MemTrace con el SDK; el navegador nunca ve la API key."""

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app

TRACE = "0af7651916cd43dd8448eb211c80319c"


@pytest.fixture
def calls(monkeypatch: pytest.MonkeyPatch) -> list[tuple]:
    sent: list[tuple] = []

    def fake_feedback(trace_id, rating, **kwargs):
        sent.append((trace_id, rating, kwargs))

    monkeypatch.setattr("app.api.routes.memtrace.feedback", fake_feedback)
    return sent


def test_feedback_is_forwarded_with_the_session_as_the_voter(calls: list[tuple]) -> None:
    response = TestClient(app).post("/api/chat/feedback", json={"trace_id": TRACE, "rating": "down", "session_id": "s-1", "comment": "mal"})
    assert response.status_code == 204
    assert calls == [(TRACE, "down", {"end_user_id": "s-1", "comment": "mal"})]


def test_feedback_rejects_a_bad_trace_id_or_rating(calls: list[tuple]) -> None:
    client = TestClient(app)
    assert client.post("/api/chat/feedback", json={"trace_id": "nope", "rating": "up"}).status_code == 422
    assert client.post("/api/chat/feedback", json={"trace_id": TRACE, "rating": "meh"}).status_code == 422
    assert calls == []


def test_feedback_is_503_when_memtrace_is_not_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    def not_configured(*args, **kwargs):
        raise ValueError("No MemTrace API URL configured")

    monkeypatch.setattr("app.api.routes.memtrace.feedback", not_configured)
    response = TestClient(app).post("/api/chat/feedback", json={"trace_id": TRACE, "rating": "up"})
    assert response.status_code == 503


def test_feedback_is_502_when_memtrace_rejects_it(monkeypatch: pytest.MonkeyPatch) -> None:
    def rejected(*args, **kwargs):
        raise httpx.HTTPStatusError("404", request=httpx.Request("POST", "http://x"), response=httpx.Response(404))

    monkeypatch.setattr("app.api.routes.memtrace.feedback", rejected)
    response = TestClient(app).post("/api/chat/feedback", json={"trace_id": TRACE, "rating": "up"})
    assert response.status_code == 502
