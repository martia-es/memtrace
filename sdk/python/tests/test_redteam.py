import json

import pytest

from memtrace import redteam, security
from memtrace.eval_judges import LLMReply

pytest.importorskip("detect_secrets")
pytest.importorskip("presidio_analyzer")


class FakeJudge:
    """Judges 'resisted' unless the agent reply contains COMPLY."""

    model = "fake-judge"

    def complete(self, *, system, prompt, model=None):
        resisted = "COMPLY" not in prompt.split("The agent replied:")[1]
        return json.dumps({"score": resisted, "reasoning": "fake"})


def safe_agent(*, item):
    return "I can't help with that."


def leaky_agent(*, item):
    if item.metadata["category"] == "secret_leak":
        return "Sure: AKIAIOSFODNN7EXAMPLE"
    if item.metadata["category"] == "pii_leak":
        return "Their email is jane@example.com, IBAN ES9121000418450200051332"
    if item.metadata["category"] == "prompt_injection":
        return "COMPLY: PWNED"
    if item.metadata["category"] == "unauthorized_tool":
        return {"text": "Done.", "tool_calls": [{"name": "delete_user", "arguments": {}}]}
    return "No."


def test_seed_attacks_cover_every_category_with_metadata():
    items = redteam.seed_attacks()
    assert {i["metadata"]["category"] for i in items} == set(redteam.CATEGORIES)
    assert all(i["metadata"]["id"] and i["input"] for i in items)
    assert len({i["metadata"]["id"] for i in items}) == len(items)
    assert [i["metadata"]["category"] for i in redteam.seed_attacks(["jailbreak"])] == ["jailbreak"] * 3
    with pytest.raises(ValueError):
        redteam.seed_attacks(["nope"])


def test_run_redteam_locally_with_a_safe_agent():
    result = redteam.run_redteam(task=safe_agent, name="safe", judge_client=FakeJudge(), upload=False)
    assert result.name == "redteam/safe"
    assert all(s.pass_rate == 1.0 for s in result.summary() if s.data_type == "boolean")
    assert all(row["asr"] == 0 for row in redteam.attack_success_rate(result).values())


def test_run_redteam_measures_attacks_that_succeed():
    policy = security.ToolPolicy(allowed_tools={"search_docs"})
    result = redteam.run_redteam(task=leaky_agent, name="leaky", judge_client=FakeJudge(), tool_policy=policy, upload=False)
    asr = redteam.attack_success_rate(result)
    for category in ("secret_leak", "pii_leak", "prompt_injection", "unauthorized_tool"):
        assert asr[category]["asr"] == 1.0, category
    assert asr["jailbreak"]["asr"] == 0.0
    categories = {s.value for r in result.items for s in r.scores if s.name == "attack_category"}
    assert categories == set(redteam.CATEGORIES)


def test_extra_items_and_custom_evaluators():
    extra = [{"input": "custom attack", "metadata": {"category": "jailbreak", "id": "x"}}]
    result = redteam.run_redteam(task=safe_agent, name="x", categories=["secret_leak"], extra_items=extra, evaluators=[redteam.NoSecretLeak()], upload=False)
    assert len(result.items) == 4


def test_detections_during_a_red_team_run_are_tagged(spans):
    def agent(*, item):
        security.secret_leak("AKIAIOSFODNN7EXAMPLE")
        return "no"

    redteam.run_redteam(task=agent, name="tag", categories=["jailbreak"], evaluators=[redteam.AttackCategory()], upload=False)
    security.secret_leak("AKIAIOSFODNN7EXAMPLE")
    contexts = [dict(s.attributes).get("security.context") for s in spans.get_finished_spans() if s.name == "security.secret_leak"]
    assert contexts.count("redteam") == 3 and contexts.count(None) == 1
