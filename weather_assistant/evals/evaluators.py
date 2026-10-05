"""Evaluadores del asistente del tiempo. Funciones puras: se testean sin LLM ni red."""

import re
import unicodedata
from collections.abc import Mapping, Sequence
from typing import Any

from memtrace.eval import Score


def _norm(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()


def mentions_number(text: str, number: int) -> bool:
    """`21` casa con "21 °C", "21.0" y "21,0", pero no con "121" ni "2.1"."""
    return re.search(rf"(?<![\d.,\-]){number}(?:[.,]0)?(?!\d)", text) is not None


def _contains(text: str, needle: str | int) -> bool:
    if isinstance(needle, int):
        return mentions_number(text, needle)
    return _norm(needle) in _norm(text)


def check_tool_calls(calls: Sequence[Mapping[str, Any]], expected: Sequence[Mapping[str, Any]]) -> tuple[bool, str]:
    """Cada llamada esperada debe aparecer (localidad y rango de `days`) y no puede haber otras."""
    remaining = list(calls)
    for want in expected:
        match = next(
            (
                call
                for call in remaining
                if _norm(want["location"]) in _norm(str(call.get("location", "")))
                and want["min_days"] <= int(call.get("days", 1)) <= want["max_days"]
            ),
            None,
        )
        if match is None:
            return False, f"falta get_weather({want['location']}, days {want['min_days']}-{want['max_days']}); hubo {list(calls)}"
        remaining.remove(match)
    if remaining:
        return False, f"llamadas inesperadas: {remaining}"
    return True, "ok"


def check_response(output: str, metadata: Mapping[str, Any]) -> tuple[bool, str]:
    for needle in metadata.get("must_contain", []):
        if not _contains(output, needle):
            return False, f"falta {needle!r}"
    any_of = metadata.get("must_contain_any")
    if any_of and not any(_contains(output, needle) for needle in any_of):
        return False, f"ninguna de {any_of}"
    for needle in metadata.get("must_not_contain", []):
        if _contains(output, needle):
            return False, f"no debería contener {needle!r}"
    for pattern in metadata.get("must_not_match", []):
        if re.search(pattern, output, re.IGNORECASE):
            return False, f"coincide con el patrón prohibido {pattern!r}"
    return True, "ok"


class ToolCalls:
    """¿Llamó a `get_weather` con la localidad y los días correctos, y solo cuando tocaba?"""

    name = "tool_calls"

    def __init__(self, recorded_calls: Mapping[str, list[dict]]) -> None:
        self._recorded = recorded_calls  # input -> llamadas a get_weather (las rellena la tarea)

    def __call__(self, *, input: str, metadata: Mapping[str, Any] | None) -> list[Score]:
        if not metadata or "expected_tools" not in metadata:
            return []  # item sin trayectoria esperada: sin score
        ok, comment = check_tool_calls(self._recorded.get(input, []), metadata["expected_tools"])
        return [Score(name=self.name, value=ok, data_type="boolean", comment=comment)]


def response_checks(*, output: str, metadata: Mapping[str, Any] | None) -> Score:
    """¿La respuesta contiene los datos que debe, sin inventar ni filtrar lo que no debe?"""
    ok, comment = check_response(output, metadata or {})
    return Score(name="response_checks", value=ok, data_type="boolean", comment=comment)


response_checks.name = "response_checks"  # type: ignore[attr-defined]
