"""Maps Pydantic AI's agent-span attributes to the standard `gen_ai.*` ones.

Pydantic AI already emits `gen_ai.*` on its model-call (`chat`) spans. Its agent span
(`invoke_agent`) carries its own keys instead, so the dashboard shows no content for it.
"""

import json
from typing import Any, Dict, Mapping

from memtrace.application.span_normalization import fill_missing

ALL_MESSAGES = "pydantic_ai.all_messages"
FINAL_RESULT = "final_result"
USAGE_RENAMES = {
    "gen_ai.aggregated_usage.input_tokens": "gen_ai.usage.input_tokens",
    "gen_ai.aggregated_usage.output_tokens": "gen_ai.usage.output_tokens",
    "gen_ai.aggregated_usage.details.text_prompt_tokens": "gen_ai.usage.details.text_prompt_tokens",
}


class PydanticAiSpanNormalizer:
    def normalize(self, attributes: Mapping[str, Any]) -> Dict[str, Any]:
        derived: Dict[str, Any] = {}
        derived.update(self._messages(attributes))
        for source, target in USAGE_RENAMES.items():
            if source in attributes:
                derived[target] = attributes[source]
        return fill_missing(attributes, derived)

    @staticmethod
    def _messages(attributes: Mapping[str, Any]) -> Dict[str, Any]:
        raw = attributes.get(ALL_MESSAGES)
        if not isinstance(raw, str):
            return {}
        try:
            messages = json.loads(raw)
        except ValueError:
            return {}
        last_user = next((i for i in range(len(messages) - 1, -1, -1) if messages[i].get("role") == "user"), None)
        derived: Dict[str, Any] = {}
        if last_user is not None:
            derived["gen_ai.input.messages"] = json.dumps([messages[last_user]], ensure_ascii=False)
        final = attributes.get(FINAL_RESULT)
        if isinstance(final, str) and final:
            derived["gen_ai.output.messages"] = json.dumps(
                [{"role": "assistant", "parts": [{"type": "text", "content": final}]}], ensure_ascii=False
            )
        return derived
