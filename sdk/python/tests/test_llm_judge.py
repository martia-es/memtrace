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


def test_judge_score_records_explicit_model_and_prompt_hash():
    client = FakeLLMClient(json.dumps({"score": True, "reasoning": "ok"}))
    judge = Correctness(client=client, model="judge-model-x")

    score = judge(input="q", output="a", expected_output="a", metadata=None)

    assert score.judge_model == "judge-model-x"
    assert score.judge_prompt_hash == judge.prompt_hash()
    assert len(score.judge_prompt_hash) == 16


def test_judge_model_falls_back_to_client_default_then_none():
    class ModelledClient(FakeLLMClient):
        model = "client-default"

    reply = json.dumps({"score": True})
    with_default = Correctness(client=ModelledClient(reply))(input="q", output="a", expected_output="a", metadata=None)
    without = Correctness(client=FakeLLMClient(reply))(input="q", output="a", expected_output="a", metadata=None)

    assert with_default.judge_model == "client-default"
    assert without.judge_model is None


def test_prompt_hash_is_stable_across_items_and_differs_between_rubrics():
    client = FakeLLMClient(json.dumps({"score": True}))
    correctness, faithfulness = Correctness(client=client), Faithfulness(client=client)

    first = correctness(input="q1", output="a1", expected_output="e1", metadata=None)
    second = correctness(input="q2", output="a2", expected_output="e2", metadata=None)

    assert first.judge_prompt_hash == second.judge_prompt_hash
    assert faithfulness.prompt_hash() != correctness.prompt_hash()


def test_prompt_hash_changes_when_system_prompt_changes():
    class Strict(Correctness):
        def system_prompt(self):
            return "You are extremely harsh."

    client = FakeLLMClient("{}")
    assert Strict(client=client).prompt_hash() != Correctness(client=client).prompt_hash()
