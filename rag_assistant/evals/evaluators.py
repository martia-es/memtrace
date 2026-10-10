"""Evaluadores del asistente de FAQs. La recuperación la miden los de MemTrace (`RecallAtK`, `MRR`, `HitRate`). Funciones puras: se testean sin LLM ni red."""

import re
import unicodedata
from collections.abc import Mapping
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


def response_checks(*, output: str, metadata: Mapping[str, Any] | None) -> Score:
    """¿La respuesta contiene los datos que debe, sin inventar ni filtrar lo que no debe?"""
    ok, comment = check_response(output, metadata or {})
    return Score(name="response_checks", value=ok, data_type="boolean", comment=comment)


response_checks.name = "response_checks"  # type: ignore[attr-defined]
