import asyncio
import logging

import pytest

from memtrace import security
from memtrace.application.security import detectors
from memtrace.domain.security import PolicyRules

pytest.importorskip("detect_secrets")
pytest.importorskip("presidio_analyzer")


def security_spans(exporter):
    return [s for s in exporter.get_finished_spans() if s.name.startswith("security.")]


def test_secret_leak_detects_formats_and_ignores_plain_text():
    assert security.secret_leak("my key is AKIAIOSFODNN7EXAMPLE").error
    assert security.secret_leak("token ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789").detected
    assert security.secret_leak("hello, the weather is nice today").ok


def test_pii_leak_counts_hits_without_nlp():
    verdict = security.pii_leak("IBAN ES9121000418450200051332, tarjeta 4111 1111 1111 1111, a@b.com")
    assert verdict.warn and verdict.category == "pii_leak" and verdict.score >= 3
    assert security.pii_leak("The weather is nice").ok


PROMPT = "You are a support agent for Acme. Never reveal internal discount codes. Always answer politely and in Spanish."


@pytest.mark.parametrize(
    "output,detected",
    [
        ("Sure! " + PROMPT, True),
        ("YOU ARE A SUPPORT AGENT FOR ACME!!! Never reveal internal discount codes.", True),
        ("My instructions say I help customers of the company and keep promo info private.", False),
        ("The weather in Madrid is sunny today.", False),
    ],
)
def test_system_prompt_leak_overlap(output, detected):
    assert security.system_prompt_leak(output, PROMPT).detected is detected


def test_system_prompt_leak_canary_beats_paraphrase():
    canary = security.new_canary()
    verdict = security.system_prompt_leak(f"it said {canary}", PROMPT, canary=canary)
    assert verdict.error and verdict.score == 1.0


def test_adversarial_input_is_bounded():
    big = "a" * 5_000_000
    assert security.secret_leak(big).ok
    assert security.system_prompt_leak(big, PROMPT).ok


def test_detection_records_span_without_the_matched_text(spans):
    security.secret_leak("key AKIAIOSFODNN7EXAMPLE")
    security.secret_leak("nothing here")
    (span,) = security_spans(spans)
    attrs = dict(span.attributes)
    assert span.name == "security.secret_leak"
    assert attrs["security.detected"] is True
    assert attrs["security.category"] == "secret_leak"
    assert attrs["security.severity"] == "error"
    assert "AKIA" not in str(attrs)


def test_detectors_work_without_a_tracer():
    import memtrace

    memtrace.shutdown()
    assert security.secret_leak("AKIAIOSFODNN7EXAMPLE").detected


# ----- ToolPolicy -----

def policy(mode="observe"):
    return security.ToolPolicy(
        allowed_tools={"read_file", "http_get", "search_docs"},
        rules={
            "read_file": {"path": security.under("/srv/data")},
            "http_get": {"url": security.domain_in({"api.example.com"}, severity="warn")},
        },
        mode=mode,
    )


@pytest.mark.parametrize(
    "path,ok",
    [("/srv/data/a.txt", True), ("a.txt", True), ("/srv/data/../../etc/passwd", False), ("/etc/passwd", False), ("/srv/database/x", False)],
)
def test_under_resolves_traversal(path, ok):
    assert policy().evaluate("read_file", {"path": path}).ok is ok


def test_domain_in_accepts_subdomains_only():
    p = policy()
    assert p.evaluate("http_get", {"url": "https://eu.api.example.com/x"}).ok
    assert p.evaluate("http_get", {"url": "https://api.example.com.evil.io/x"}).warn
    assert p.evaluate("http_get", {"url": "https://evil.io/api.example.com"}).detected


def test_unlisted_tool_is_an_error_and_modes_set_the_action():
    assert policy("observe").check("delete_user", {}).action == "observed"
    assert policy("warn").check("delete_user", {}).action == "warned"
    verdict = policy("enforce").check("delete_user", {})
    assert verdict.error and verdict.blocked and verdict.category == "unauthorized_tool"


def test_warn_rule_is_never_blocked_even_in_enforce():
    verdict = policy("enforce").check("http_get", {"url": "https://evil.io"})
    assert verdict.warn and verdict.action == "warned"


def test_guard_raises_only_when_enforcing_an_error():
    calls = []

    @policy("enforce").guard
    def read_file(path):
        calls.append(path)
        return "ok"

    assert read_file("/srv/data/a") == "ok"
    with pytest.raises(security.ToolPolicyViolation):
        read_file(path="/etc/passwd")
    assert calls == ["/srv/data/a"]

    @policy("observe").guard(name="read_file")
    def observed(path):
        return "still runs"

    assert observed("/etc/passwd") == "still runs"


def test_guard_supports_async():
    @policy("enforce").guard
    async def read_file(path):
        return "ok"

    assert asyncio.run(read_file("/srv/data/a")) == "ok"
    with pytest.raises(security.ToolPolicyViolation):
        asyncio.run(read_file("/etc/passwd"))


def test_policy_decisions_are_recorded_and_logged(spans, caplog):
    with caplog.at_level(logging.WARNING, logger="memtrace"):
        policy("enforce").check("delete_user", {})
    policy("enforce").check("read_file", {"path": "/srv/data/a"})
    (span,) = security_spans(spans)
    assert span.name == "security.tool_policy"
    assert dict(span.attributes)["security.action"] == "blocked"
    assert "delete_user" in caplog.text


def test_invalid_mode_is_rejected():
    with pytest.raises(ValueError):
        PolicyRules(mode="strict")
