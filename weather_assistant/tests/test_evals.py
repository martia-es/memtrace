"""El dataset y los evaluadores de `evals/` se validan sin LLM ni red."""

import json
import sys
from pathlib import Path

import pytest

EVALS = Path(__file__).resolve().parents[1] / "evals"
sys.path.insert(0, str(EVALS))

from evaluators import ToolCalls, check_response, check_tool_calls, mentions_number  # noqa: E402
from fakes import CITIES, FakeWeatherService  # noqa: E402

ROWS = [json.loads(line) for line in (EVALS / "dataset.jsonl").read_text().splitlines() if line.strip()]


def test_inputs_are_unique():
    inputs = [row["input"] for row in ROWS]
    assert len(inputs) == len(set(inputs))


@pytest.mark.parametrize("row", ROWS, ids=lambda row: row["input"][:40])
def test_ideal_answer_passes_its_own_checks(row):
    ok, comment = check_response(row["expected_output"], row["metadata"])
    assert ok, comment


@pytest.mark.parametrize("row", ROWS, ids=lambda row: row["input"][:40])
def test_expected_cities_exist_in_fake_service(row):
    import asyncio

    service = FakeWeatherService()
    for want in row["metadata"]["expected_tools"]:
        if want["location"] == "Narnia":
            continue
        assert asyncio.run(service.find_location(want["location"])).name


def test_number_matching():
    assert mentions_number("hay 21 °C", 21) and mentions_number("21,0 grados", 21)
    assert not mentions_number("121 °C", 21) and not mentions_number("2.1 °C", 21)


def test_tool_call_checks():
    assert check_tool_calls([{"location": "Madrid", "days": 2}], [{"location": "madrid", "min_days": 2, "max_days": 7}])[0]
    assert not check_tool_calls([{"location": "Madrid", "days": 1}], [{"location": "Madrid", "min_days": 2, "max_days": 7}])[0]
    assert not check_tool_calls([{"location": "Madrid"}], [])[0]  # llamada de más
    assert ToolCalls({})(input="x", metadata={}) == []
    assert len(CITIES) >= 7
