import pytest

from memtrace import config
from memtrace.config import Settings, env_bool, env_int, parse_headers


def test_parse_headers():
    assert parse_headers("a=1, b = two ,broken,=x") == {"a": "1", "b": "two"}
    assert parse_headers(None) == {}


@pytest.mark.parametrize("raw,expected", [("true", True), ("1", True), ("YES", True), ("off", False), ("", False)])
def test_env_bool(monkeypatch, raw, expected):
    monkeypatch.setenv("X_FLAG", raw)
    assert env_bool("X_FLAG", not expected) is expected


def test_env_bool_default_when_unset(monkeypatch):
    monkeypatch.delenv("X_FLAG", raising=False)
    assert env_bool("X_FLAG", True) is True


def test_env_int_falls_back_on_garbage(monkeypatch):
    monkeypatch.setenv("X_INT", "abc")
    assert env_int("X_INT", 7) == 7
    monkeypatch.setenv("X_INT", "12")
    assert env_int("X_INT", 7) == 12


def test_protocol_and_default_endpoint(monkeypatch):
    s = Settings()
    monkeypatch.delenv("MEMTRACE_OTLP_PROTOCOL", raising=False)
    assert s.protocol == config.PROTOCOL_GRPC
    assert config.default_endpoint(s.protocol) == "http://localhost:4317"
    monkeypatch.setenv("MEMTRACE_OTLP_PROTOCOL", "HTTP")
    assert s.protocol == config.PROTOCOL_HTTP
    assert config.default_endpoint(s.protocol) == "http://localhost:4318"


def test_settings_read_environment_live(monkeypatch):
    s = Settings()
    monkeypatch.setenv("MEMTRACE_SERVICE_NAME", "svc")
    monkeypatch.setenv("MEMTRACE_OTLP_HEADERS", "authorization=Bearer k")
    monkeypatch.setenv("MEMTRACE_MAX_ACTIVE_RUNS", "5")
    monkeypatch.setenv("MEMTRACE_REDACT_KEYS", " Foo ,bar,, ")
    assert s.service_name == "svc"
    assert s.otlp_headers == {"authorization": "Bearer k"}
    assert s.max_active_runs == 5
    assert s.redact_keys == ("foo", "bar")
