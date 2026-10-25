"""Value objects and pure rules for agent security (see ADR-103).

Nothing here touches OpenTelemetry or a third-party library: a `Verdict` is what any detector or
policy returns, and `PolicyRules` is plain comparison of values the developer declared.
"""
import posixpath
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Mapping, Optional
from urllib.parse import urlparse

CATEGORIES = (
    "prompt_injection",
    "indirect_injection",
    "jailbreak",
    "system_prompt_leak",
    "secret_leak",
    "pii_leak",
    "unauthorized_tool",
    "harmful_content",
)
SEVERITIES = ("info", "warn", "error")
ACTIONS = ("observed", "warned", "blocked")


@dataclass(frozen=True)
class Verdict:
    """What a detector or policy decided about one input, output or tool call.

    `reason` is for the developer's code and logs only: it never contains the text that was detected
    and it is not recorded in the trace (only `category`, `severity`, `action` and `score` are).
    """

    detector: str
    detected: bool
    category: Optional[str] = None
    severity: str = "info"
    action: str = "observed"
    score: Optional[float] = None
    reason: Optional[str] = None

    @property
    def ok(self) -> bool:
        return not self.detected

    @property
    def warn(self) -> bool:
        return self.detected and self.severity == "warn"

    @property
    def error(self) -> bool:
        return self.detected and self.severity == "error"

    @property
    def blocked(self) -> bool:
        return self.action == "blocked"


class ToolPolicyViolation(Exception):
    """Raised by `ToolPolicy.guard` when a tool call breaks an `error` rule in `enforce` mode."""

    def __init__(self, verdict: Verdict):
        super().__init__(verdict.reason or "tool call blocked by policy")
        self.verdict = verdict


@dataclass(frozen=True)
class Rule:
    """A check on one argument of a tool. `severity` is what a violation counts as (`warn` or `error`)."""

    check: Callable[[Any], bool]
    description: str
    severity: str = "error"


def under(root: str, *, severity: str = "error") -> Rule:
    """A filesystem path that stays inside `root`. Relative paths are taken relative to `root`; `..` is resolved first."""
    base = posixpath.normpath(root)

    def check(value: Any) -> bool:
        if not isinstance(value, str) or "\x00" in value:
            return False
        path = posixpath.normpath(value if posixpath.isabs(value) else posixpath.join(base, value))
        return path == base or path.startswith(base.rstrip("/") + "/")

    return Rule(check, f"under({root!r})", severity)


def domain_in(domains: Iterable[str], *, severity: str = "error") -> Rule:
    """A URL whose host is one of `domains` or a subdomain of one."""
    allowed = tuple(d.lower().lstrip(".") for d in domains)

    def check(value: Any) -> bool:
        try:
            host = (urlparse(value).hostname or "").lower() if isinstance(value, str) else ""
        except ValueError:
            return False
        return any(host == d or host.endswith("." + d) for d in allowed)

    return Rule(check, f"domain_in({sorted(allowed)!r})", severity)


def one_of(values: Iterable[Any], *, severity: str = "error") -> Rule:
    allowed = tuple(values)
    return Rule(lambda value: value in allowed, f"one_of({list(allowed)!r})", severity)


def forbids(pattern: str, *, flags: int = 0, severity: str = "error") -> Rule:
    """The argument (as text, truncated to 10 KB) must NOT match `pattern`, e.g. `forbids(r"\\b(drop|delete)\\b", flags=re.I)`."""
    import re

    compiled = re.compile(pattern, flags)
    return Rule(lambda value: compiled.search(str(value)[:10_000]) is None, f"forbids({pattern!r})", severity)


class PolicyRules:
    """Declares which tools an agent may call and with which arguments; reports and, if asked, blocks.

    `mode`: `observe` records only, `warn` also logs, `enforce` marks `error` violations as blocked so
    `guard` raises `ToolPolicyViolation`. `check` never raises: the developer reads the `Verdict`.
    Without `allowed_tools` every tool is allowed and only the `rules` are checked.
    """

    MODES = ("observe", "warn", "enforce")

    def __init__(
        self,
        *,
        allowed_tools: Optional[Iterable[str]] = None,
        rules: Optional[Mapping[str, Mapping[str, Rule]]] = None,
        mode: str = "observe",
    ):
        if mode not in self.MODES:
            raise ValueError(f"mode must be one of {self.MODES}, got {mode!r}")
        self._allowed = frozenset(allowed_tools) if allowed_tools is not None else None
        self._rules = {tool: dict(args) for tool, args in (rules or {}).items()}
        self.mode = mode

    def evaluate(self, tool: str, arguments: Optional[Mapping[str, Any]] = None) -> Verdict:
        """Pure decision, without recording or logging."""
        if self._allowed is not None and tool not in self._allowed:
            return self._verdict("error", f"tool {tool!r} is not in allowed_tools")
        worst, reason = None, None
        for argument, rule in self._rules.get(tool, {}).items():
            if argument not in (arguments or {}):
                continue
            if not rule.check(arguments[argument]):
                if worst != "error":
                    worst, reason = rule.severity, f"argument {argument!r} of {tool!r} violates {rule.description}"
        if worst is None:
            return Verdict("tool_policy", detected=False)
        return self._verdict(worst, reason)

    def _verdict(self, severity: str, reason: Optional[str]) -> Verdict:
        if self.mode == "observe":
            action = "observed"
        elif self.mode == "warn" or severity == "warn":
            action = "warned"
        else:
            action = "blocked"
        return Verdict("tool_policy", True, "unauthorized_tool", severity, action, reason=reason)
