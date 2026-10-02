import json

import pytest

from memtrace.eval_judges import Correctness, Faithfulness


class FakeLLMClient:
    """Records the last prompt it was asked and returns a canned JSON reply."""

    def __init__(self, reply):
        self._reply = reply
        self.last_system = None
        self.last_prompt = None
        self.last_model = None

    def complete(self, *, system, prompt, model=None):
        self.last_system = system
        self.last_prompt = prompt
        self.last_model = model
        return self._reply


def test_correctness_true_when_judge_agrees():
    client = FakeLLMClient(json.dumps({"score": True, "reasoning": "same meaning"}))
    judge = Correctness(client=client)

    score = judge(input="capital of France?", output="It's Paris.", expected_output="Paris", metadata=None)

    assert score.name == "correctness"
    assert score.value is True
    assert score.source == "llm_judge"
    assert score.comment == "same meaning"
    assert "capital of France?" in client.last_prompt
    assert "Paris" in client.last_prompt


def test_correctness_false_when_judge_disagrees():
    client = FakeLLMClient(json.dumps({"score": False, "reasoning": "wrong city"}))
    judge = Correctness(client=client)

    score = judge(input="capital of Spain?", output="Barcelona", expected_output="Madrid", metadata=None)

    assert score.value is False


def test_judge_raises_on_non_json_reply():
    client = FakeLLMClient("sure, it's correct!")
    judge = Correctness(client=client)

    with pytest.raises(ValueError, match="non-JSON"):
        judge(input="q", output="a", expected_output="a", metadata=None)


def test_judge_passes_model_override_to_client():
    client = FakeLLMClient(json.dumps({"score": True}))
    judge = Correctness(client=client, model="claude-haiku-4-5-20251001")

    judge(input="q", output="a", expected_output="a", metadata=None)

    assert client.last_model == "claude-haiku-4-5-20251001"


def test_faithfulness_uses_context_from_metadata():
    client = FakeLLMClient(json.dumps({"score": True, "reasoning": "grounded"}))
    judge = Faithfulness(client=client)

    score = judge(
        input="What year was it founded?",
        output="1999",
        expected_output=None,
        metadata={"context": "The company was founded in 1999."},
    )

    assert score.value is True
    assert "founded in 1999" in client.last_prompt


def test_faithfulness_raises_without_context_in_metadata():
    judge = Faithfulness(client=FakeLLMClient(json.dumps({"score": True})))

    with pytest.raises(ValueError, match="context"):
        judge(input="q", output="a", expected_output=None, metadata=None)
