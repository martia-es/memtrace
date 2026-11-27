"""Mem findings and the lessons distilled from them (phase 2.2, `docs/archive/phase_2_design.md`).

A `Finding` is what MemTrace's discovery worker found (`GET /mem/patterns`): a rule that explains a recurring failure. A
`Lesson` is a short instruction a person can review, written by an LLM of the team's choice from that finding only. Pure data:
no network, no LLM.
"""
from dataclasses import dataclass, field
from typing import Mapping, Tuple

MAX_TITLE_CHARS = 80
MAX_GUIDANCE_CHARS = 400
MAX_WHEN_CHARS = 200
MAX_RATIONALE_CHARS = 300


class LessonError(Exception):
    """The model's lesson cannot be used (unreadable, empty or too long)."""


@dataclass(frozen=True)
class Finding:
    """A recurring failure and the rule that explains it, as the API returns it (camelCase there, snake_case here)."""

    finding_id: str
    cause: str
    rule: str
    support: int
    failures: int
    failure_rate: float
    lift: float
    decisive_step: str = ""
    decisive_error: str = ""
    tool_sequence: str = ""
    occurrence_by_prompt: Mapping[str, float] = field(default_factory=dict)
    example_trace_ids: Tuple[str, ...] = ()

    @classmethod
    def from_api(cls, body: Mapping) -> "Finding":
        return cls(
            finding_id=str(body["findingId"]),
            cause=str(body.get("cause", "")),
            rule=str(body.get("rule", "")),
            support=int(body.get("support", 0)),
            failures=int(body.get("failures", 0)),
            failure_rate=float(body.get("failureRate", 0.0)),
            lift=float(body.get("lift", 0.0)),
            decisive_step=str(body.get("decisiveStep", "")),
            decisive_error=str(body.get("decisiveError", "")),
            tool_sequence=str(body.get("toolSequence", "")),
            occurrence_by_prompt={str(k): float(v) for k, v in (body.get("occurrenceByPrompt") or {}).items()},
            example_trace_ids=tuple(str(t) for t in (body.get("exampleTraceIds") or ())),
        )


@dataclass(frozen=True)
class Lesson:
    """What the agent should do differently, in one instruction. Generated text: it never quotes a user's message."""

    finding_id: str
    title: str
    guidance: str
    applies_when: str
    rationale: str
    evidence_trace_ids: Tuple[str, ...] = ()
