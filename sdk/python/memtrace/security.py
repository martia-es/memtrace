"""Deterministic security detectors for a running agent (see ADR-103).

They run inside your agent, make no network call and use no LLM. Each returns a `Verdict`; when it detects
something (and `init_tracer()` ran) it also records a `security.<detector>` span with the category, severity,
action and score — never the text that matched. You decide in code whether to continue:

    from memtrace import security

    verdict = security.secret_leak(reply)
    if verdict.error:
        reply = "I can't share that."

    policy = security.ToolPolicy(
        allowed_tools={"search_docs", "read_file"},
        rules={"read_file": {"path": security.under("/srv/data")}},
        mode="enforce",            # observe (default) | warn | enforce
    )

    @policy.guard                  # raises ToolPolicyViolation when an `error` rule is broken in enforce mode
    def read_file(path): ...

`secret_leak` and `pii_leak` need the `security` extra: pip install 'memtrace-ai[security]'.
Prompt injection has no production detector on purpose: measure it with `memtrace.redteam`.
"""
from memtrace.application.security import detectors as _detectors
from memtrace.application.security.policy import ToolPolicy as _ToolPolicy
from memtrace.application.security.recorder import record as _record
from memtrace.dependency_container import active_service
from memtrace.domain.security import (
    ACTIONS,
    CATEGORIES,
    SEVERITIES,
    Rule,
    ToolPolicyViolation,
    Verdict,
    domain_in,
    forbids,
    one_of,
    under,
)

__all__ = [
    "secret_leak",
    "pii_leak",
    "system_prompt_leak",
    "new_canary",
    "ToolPolicy",
    "ToolPolicyViolation",
    "Verdict",
    "Rule",
    "under",
    "domain_in",
    "one_of",
    "forbids",
    "CATEGORIES",
    "SEVERITIES",
    "ACTIONS",
]

new_canary = _detectors.new_canary


class ToolPolicy(_ToolPolicy):
    """Declares which tools an agent may call and with which arguments (see `PolicyRules`); records to the active tracer."""

    def _service(self):
        return active_service()


def secret_leak(text: str) -> Verdict:
    """API keys, tokens and private keys in `text`. Severity `error`."""
    verdict = _detectors.secret_leak(text)
    _record(active_service(), verdict)
    return verdict


def pii_leak(text: str) -> Verdict:
    """Card numbers, IBANs, emails, Spanish NIF and US SSN in `text`. Severity `warn`; `score` is the number of hits."""
    verdict = _detectors.pii_leak(text)
    _record(active_service(), verdict)
    return verdict


def system_prompt_leak(output: str, system_prompt: str, *, threshold: float = 0.3, canary=None) -> Verdict:
    """Does `output` copy the system prompt (word 3-gram overlap >= `threshold`) or contain its `canary`? Paraphrases are not caught."""
    verdict = _detectors.system_prompt_leak(output, system_prompt, threshold=threshold, canary=canary)
    _record(active_service(), verdict)
    return verdict
