"""Runs the language-neutral scenarios in sdk/conformance/ against this SDK (ADR-095).

Each JSON file is a scenario; the format is documented in sdk/conformance/README.md. The TypeScript SDK runs the
same files, so a divergence in an attribute name or a request shape fails in CI instead of in the dashboard.
"""
import json
import os
from pathlib import Path
from typing import Any, Dict, List

import httpx
import pytest
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

import memtrace
from memtrace.adapters.outbound.http.eval_api_client import MemTraceResultsSink
from memtrace.adapters.outbound.http.prompt_client import HttpPromptClient
from memtrace.domain.evaluation import EvalItem, EvalItemResult, ExperimentResult, RunRepeat, Score

ROOT = Path(__file__).resolve().parents[2] / "conformance"


def _scenarios(kind: str):
    files = sorted((ROOT / kind).glob("*.json"))
    assert files, f"no scenarios in {ROOT / kind}"
    return [pytest.param(json.loads(f.read_text()), id=f.stem) for f in files]


@pytest.fixture
def clean_env(monkeypatch):
    for name in list(os.environ):
        if name.startswith("MEMTRACE_") or name in ("GITHUB_SHA", "GIT_SHA"):
            monkeypatch.delenv(name)
    return monkeypatch


# ----- tracing -----


class ScenarioFailure(Exception):
    """What a `fail` action raises; it propagates up to the top of the scenario, like any agent error."""


def _run_actions(actions: List[Dict[str, Any]]) -> None:
    for action in actions:
        op = action["op"]
        if op == "session":
            with memtrace.session(action["id"]):
                _run_actions(action.get("actions", []))
        elif op == "user":
            with memtrace.user(action["id"]):
                _run_actions(action.get("actions", []))
        elif op == "step":
            with memtrace.trace_step_context(action["name"], action.get("type", "chain")):
                _run_actions(action.get("actions", []))
                if "fail" in action:
                    raise ScenarioFailure(action["fail"])
        elif op == "llm":
            memtrace.trace_llm_call(
                action["provider"], action["model"],
                input_messages=action.get("inputMessages"), output_messages=action.get("outputMessages"),
                input_tokens=action.get("inputTokens"), output_tokens=action.get("outputTokens"),
                response_model=action.get("responseModel"), finish_reasons=action.get("finishReasons", ()),
                temperature=action.get("temperature"),
            )
        else:
            raise AssertionError(f"unknown op {op!r}")


def _has_fail(action: Dict[str, Any]) -> bool:
    return "fail" in action or any(_has_fail(child) for child in action.get("actions", []))


def _attr(value: Any) -> Any:
    return list(value) if isinstance(value, tuple) else value


@pytest.mark.parametrize("scenario", _scenarios("tracing"))
def test_tracing_scenario(scenario, clean_env):
    for name, value in scenario.get("env", {}).items():
        clean_env.setenv(name, value)
    memtrace.shutdown()
    exporter = InMemorySpanExporter()
    memtrace.init_tracer(service_name=scenario["init"]["serviceName"], span_exporter=exporter)
    try:
        if any(_has_fail(a) for a in scenario["actions"]):
            with pytest.raises(ScenarioFailure):
                _run_actions(scenario["actions"])
        else:
            _run_actions(scenario["actions"])
    finally:
        memtrace.shutdown()

    spans = {s.name: s for s in exporter.get_finished_spans() if s.instrumentation_scope.name == "memtrace"}
    expect = scenario["expect"]

    if "resource" in expect:
        resource = next(iter(spans.values())).resource.attributes
        for key, value in expect["resource"].items():
            assert resource.get(key) == value, f"resource attribute {key}"

    by_id = {s.context.span_id: s.name for s in spans.values()}
    for want in expect.get("spans", []):
        span = spans[want["name"]]
        if "parent" in want:
            parent = by_id.get(span.parent.span_id) if span.parent else None
            assert parent == want["parent"], f"parent of {want['name']}"
        for key, value in want.get("attributes", {}).items():
            assert _attr(span.attributes.get(key)) == value, f"{want['name']}: {key}"
        for key, value in want.get("attributesJson", {}).items():
            assert json.loads(span.attributes[key]) == value, f"{want['name']}: {key}"
        for key in want.get("absent", []):
            assert key not in span.attributes, f"{want['name']} must not have {key}"
        if "status" in want:
            assert span.status.status_code.name.lower() == want["status"], f"status of {want['name']}"


# ----- HTTP -----


def _respond(spec: Dict[str, Any]):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(spec["status"], json=spec.get("json"), headers=spec.get("headers")) if "json" in spec \
            else httpx.Response(spec["status"], headers=spec.get("headers"))
    return handler


def _call(call: Dict[str, Any], scenario: Dict[str, Any], transport) -> Any:
    base, key, op = scenario["baseUrl"], scenario["apiKey"], call["op"]
    if op == "feedback":
        return memtrace.feedback(
            call["traceId"], call["rating"], comment=call.get("comment"), end_user_id=call.get("endUserId"),
            external_message_id=call.get("externalMessageId"), base_url=base, api_key=key, transport=transport)
    if op == "retractFeedback":
        return memtrace.retract_feedback(call["traceId"], end_user_id=call.get("endUserId"), base_url=base, api_key=key, transport=transport)
    if op == "promptResolve":
        fetched = HttpPromptClient(base, key, transport=transport).fetch(call["name"], call.get("tag"), call.get("version"), call.get("etag"))
        if fetched is None:
            return None
        v = fetched.version
        return {"version": v.version, "content": v.content, "variables": list(v.variables), "etag": fetched.etag}
    if op == "evalRun":
        items = [
            EvalItemResult(
                item=EvalItem(input=i["input"], expected_output=i.get("expectedOutput")), output=i["output"], trace_id=i.get("traceId"),
                scores=[Score(name=s["name"], value=s["value"], data_type=s["dataType"]) for s in i.get("scores", [])])
            for i in call["items"]
        ]
        repeat = call.get("repeat")
        MemTraceResultsSink(call["datasetId"], base_url=base, api_key=key, transport=transport).save(
            ExperimentResult(
                name=call["runName"], items=items, dataset_version=call["datasetVersion"],
                repeat=RunRepeat(group_id=repeat["groupId"], index=repeat["index"], total=repeat["total"]) if repeat else None,
            ))
        return None
    raise AssertionError(f"unknown call {op!r}")


@pytest.mark.parametrize("scenario", _scenarios("http"))
def test_http_scenario(scenario, clean_env):
    for name, value in scenario.get("env", {}).items():
        clean_env.setenv(name, value)
    seen: List[httpx.Request] = []
    respond = _respond(scenario["respond"])

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return respond(request)

    result = _call(scenario["call"], scenario, httpx.MockTransport(handler))

    expected = scenario["expect"]["requests"]
    assert len(seen) == len(expected)
    for request, want in zip(seen, expected):
        assert request.method == want["method"]
        assert request.url.path == want["path"]
        for key, value in want.get("query", {}).items():
            assert request.url.params.get(key) == value, f"query {key}"
        for key, value in want.get("headers", {}).items():
            assert request.headers.get(key) == value, f"header {key}"
        for key in want.get("absentHeaders", []):
            assert key not in request.headers
        if "json" in want:
            assert json.loads(request.content) == want["json"]
    if "result" in scenario["expect"]:
        assert result == scenario["expect"]["result"]


# ----- evaluation -----


def _eval(name):
    return json.loads((ROOT / "eval" / f"{name}.json").read_text())


def _judge(name, client):
    from memtrace.eval_judges import Correctness, Faithfulness

    return {"correctness": Correctness, "faithfulness": Faithfulness}[name](client=client)


class _Client:
    def __init__(self, spec):
        self.model = spec["model"]
        self._reply = spec["reply"]
        self._reply_model = spec.get("replyModel")

    def complete(self, *, system, prompt, model=None):
        from memtrace.application.eval_ports import LLMReply

        return LLMReply(self._reply, model=self._reply_model) if self._reply_model else self._reply


def test_judge_prompt_hashes_match_across_sdks():
    for name, expected in _eval("judge-prompt-hash")["hashes"].items():
        assert _judge(name, _Client({"model": "m", "reply": ""})).prompt_hash() == expected, name


def test_retrieval_metrics_scenarios():
    from memtrace.application.retrieval_metrics import MRR, HitRate, RecallAtK

    for case in _eval("retrieval-metrics")["cases"]:
        scores = []
        for evaluator in (RecallAtK(2), RecallAtK(3), MRR(), HitRate()):
            scores += evaluator(metadata=case["metadata"], retrieved_chunks=case["retrieved"])
        assert [{"name": s.name, "value": s.value, "dataType": s.data_type} for s in scores] == case["expect"]


def test_judge_score_scenarios():
    scenario = _eval("judge-score")
    item = scenario["item"]
    for case in scenario["cases"]:
        judge = _judge(scenario["judge"], _Client(case["client"]))
        call = dict(input=item["input"], output=item["output"], expected_output=item["expectedOutput"])
        if case.get("expectError"):
            with pytest.raises(ValueError):
                judge(**call)
            continue
        score = judge(**call)
        want = case["expect"]
        assert (score.name, score.value, score.data_type, score.source, score.comment, score.judge_model, score.judge_prompt_hash) == (
            want["name"], want["value"], want["dataType"], want["source"], want["comment"], want["judgeModel"], want["judgePromptHash"])
