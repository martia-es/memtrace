"""Default `LLMClient` adapter for `memtrace.eval_judges`, backed by the Anthropic API.

Optional: requires `pip install 'memtrace-ai[eval]'` (the `anthropic` SDK). Only
imported when a caller actually instantiates `AnthropicJudgeClient` — nothing else in
`memtrace.eval_judges` depends on a specific LLM vendor (see ADR-029).
"""
import os
from typing import Optional

from memtrace.application.eval_ports import LLMReply

_DEFAULT_MODEL = "claude-haiku-4-5-20251001"


class AnthropicJudgeClient:
    """`LLMClient` backed by `anthropic.Anthropic`.

    Reads `ANTHROPIC_API_KEY` from the environment if `api_key` is not passed explicitly.
    """

    def __init__(self, *, api_key: Optional[str] = None, model: str = _DEFAULT_MODEL):
        try:
            import anthropic
        except ImportError as exc:
            raise ImportError("AnthropicJudgeClient requires: pip install 'memtrace-ai[eval]'") from exc
        self._client = anthropic.Anthropic(api_key=api_key or os.environ.get("ANTHROPIC_API_KEY"))
        self._model = model

    @property
    def model(self) -> str:
        """Default model used when `complete` is called without `model` (recorded on judge scores, ADR-043)."""
        return self._model

    def complete(self, *, system: str, prompt: str, model: Optional[str] = None) -> str:
        response = self._client.messages.create(
            model=model or self._model,
            max_tokens=1024,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(block.text for block in response.content if block.type == "text")
        # `response.model` is the id the API actually served (a snapshot when `model` was an alias)
        return LLMReply(text, model=getattr(response, "model", None))
