"""Mem: turn the recurring failures MemTrace found into lessons and prompt fixes, with **your** LLM (phase 2.2).

    from memtrace import mem

    finding = mem.findings()[0]                                  # a rule that explains a recurring failure
    lesson = mem.distill(finding, llm)                           # one reviewable instruction, written by your LLM
    saved = mem.save(lesson)                                     # proposed in MemTrace: a person reviews and approves it
    draft = mem.propose_fix(finding, "weather-system", llm)      # or a prompt draft for a person to review (ADR-072)

MemTrace never sees your provider key: `llm` is anything with ``complete(system=..., prompt=..., model=...)``. The model
receives the finding only (rule, counts, decisive step, normalized error), never a trace. Nothing is applied or published.
Needs `pip install 'memtrace-ai[eval]'`, `MEMTRACE_API_URL` (with the experiment id) and `MEMTRACE_API_KEY`.
"""
from dataclasses import dataclass, replace
from typing import Any, List, Mapping, Optional, Sequence

from memtrace.application.eval_ports import LLMClient
from memtrace.application.mem_distill import distill_lesson
from memtrace.application.prompt_fix import FixCase
from memtrace.adapters.outbound.http.mem_client import MemSourceError
from memtrace.domain.lesson import Finding, Lesson, LessonError
from memtrace.prompts import Draft
from memtrace.prompts import propose_fix as _propose_prompt_fix

__all__ = ["findings", "distill", "save", "propose_fix", "Finding", "Lesson", "LessonError", "MemSourceError", "SavedLesson"]


@dataclass(frozen=True)
class SavedLesson:
    """A lesson proposed in MemTrace. It is `proposed` until a person reviews and approves it; nothing reaches the agent yet."""

    lesson_id: str
    status: str
    version: int


def findings(
    *,
    since: Optional[str] = None,
    until: Optional[str] = None,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    transport: Optional[Any] = None,
) -> List[Finding]:
    """The findings of the agent's last discovery run (ISO dates optionally narrow the range)."""
    from memtrace.adapters.outbound.http.mem_client import HttpMemClient
    from memtrace.config import settings

    url = base_url or settings.api_url
    if not url:
        raise ValueError("No MemTrace API URL configured; pass base_url= or set MEMTRACE_API_URL")
    client = HttpMemClient(url, api_key if api_key is not None else settings.api_key, transport=transport)
    try:
        return client.findings(since=since, until=until)
    finally:
        client.close()


def distill(finding: Finding, llm: LLMClient, *, instructions: Optional[str] = None, model: Optional[str] = None) -> Lesson:
    """Asks your `llm` for a short, reviewable lesson that would avoid `finding`. Raises `LessonError` if the answer is unusable."""
    return distill_lesson(finding, llm, instructions=instructions, model=model)


def save(
    lesson: Lesson,
    *,
    match: Optional[Mapping[str, Sequence[str]]] = None,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    transport: Optional[Any] = None,
) -> SavedLesson:
    """Proposes `lesson` in MemTrace (state `proposed`). A person reviews it in MemTrace; only an approved lesson can ever reach the agent.

    `match` says when the lesson applies (``{"tools": ["search_flights"]}``, also ``errorCategories`` and ``intents``). It
    defaults to the tool where the finding breaks; when the finding has no tool (a silent failure or a model error), pass it.
    Raises `LessonError` without a trigger, and `MemSourceError` if MemTrace refuses (e.g. the finding already has a lesson).
    """
    from memtrace.adapters.outbound.http.mem_client import HttpMemClient
    from memtrace.config import settings

    trigger = {key: tuple(values) for key, values in (match if match is not None else lesson.match).items() if values}
    if not trigger:
        raise LessonError("This lesson has no trigger: pass match={'tools': [...]} (or 'errorCategories' / 'intents') to say when it applies")
    url = base_url or settings.api_url
    if not url:
        raise ValueError("No MemTrace API URL configured; pass base_url= or set MEMTRACE_API_URL")
    client = HttpMemClient(url, api_key if api_key is not None else settings.api_key, transport=transport)
    try:
        saved = client.save_lesson(replace(lesson, match=trigger))
    finally:
        client.close()
    return SavedLesson(lesson_id=str(saved["lesson"]["id"]), status=str(saved["lesson"]["status"]), version=int(saved["current"]["version"]))


def propose_fix(
    finding: Finding,
    name: str,
    llm: LLMClient,
    *,
    tag: Optional[str] = None,
    version: Optional[int] = None,
    model: Optional[str] = None,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    transport: Optional[Any] = None,
) -> Draft:
    """Distills `finding` and saves a **draft** of prompt `name` that applies the lesson (flow of ADR-072; a person publishes it).

    The draft keeps the finding's example traces as its origin, so the reviewer can open them.
    """
    lesson = distill_lesson(finding, llm, model=model)
    case = FixCase(
        input=f"Requests where: {finding.rule}",
        error=finding.decisive_error or finding.cause,
        trace_id=next(iter(finding.example_trace_ids), None),
    )
    return _propose_prompt_fix(
        name,
        [case],
        llm,
        tag=tag,
        version=version,
        instructions=f"Apply this lesson: {lesson.guidance} (applies when: {lesson.situation})",
        model=model,
        base_url=base_url,
        api_key=api_key,
        transport=transport,
    )
