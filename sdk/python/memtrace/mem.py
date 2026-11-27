"""Mem: turn the recurring failures MemTrace found into lessons and prompt fixes, with **your** LLM (phase 2.2).

    from memtrace import mem

    finding = mem.findings()[0]                                  # a rule that explains a recurring failure
    lesson = mem.distill(finding, llm)                           # one reviewable instruction, written by your LLM
    draft = mem.propose_fix(finding, "weather-system", llm)      # a prompt draft for a person to review (ADR-072)

MemTrace never sees your provider key: `llm` is anything with ``complete(system=..., prompt=..., model=...)``. The model
receives the finding only (rule, counts, decisive step, normalized error), never a trace. Nothing is applied or published.
Needs `pip install 'memtrace-ai[eval]'`, `MEMTRACE_API_URL` (with the experiment id) and `MEMTRACE_API_KEY`.
"""
from typing import Any, List, Optional

from memtrace.application.eval_ports import LLMClient
from memtrace.application.mem_distill import distill_lesson
from memtrace.application.prompt_fix import FixCase
from memtrace.domain.lesson import Finding, Lesson, LessonError
from memtrace.prompts import Draft
from memtrace.prompts import propose_fix as _propose_prompt_fix

__all__ = ["findings", "distill", "propose_fix", "Finding", "Lesson", "LessonError"]


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
        instructions=f"Apply this lesson: {lesson.guidance} (applies when: {lesson.applies_when})",
        model=model,
        base_url=base_url,
        api_key=api_key,
        transport=transport,
    )
