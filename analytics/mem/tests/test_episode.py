import json
from datetime import datetime, timedelta, timezone

from mem.episode import (
    EPISODE_VERSION,
    SpanRow,
    TraceSignals,
    build_episode,
    decisive_span,
    messages_text,
    normalise_error,
)

T0 = datetime(2026, 11, 1, 10, 0, tzinfo=timezone.utc)


def span(i, *, op="chat", parent="root", tool="", args="", status="STATUS_CODE_UNSET", msg="", exc="", inp="", out=""):
    return SpanRow(span_id=f"s{i}", parent_span_id=parent, timestamp=T0 + timedelta(seconds=i), name=f"{op} x", operation=op,
                   tool_name=tool, tool_args=args, tool_result="", status_code=status, status_message=msg,
                   exception_type=exc, input_messages=inp, output_messages=out)


def user(text):
    return json.dumps([{"role": "user", "parts": [{"type": "text", "content": text}]}])


def assistant(text):
    return json.dumps([{"role": "assistant", "parts": [{"type": "text", "content": text}]}])


def build(spans, signals=TraceSignals()):
    return build_episode("t1", "svc", "exp", spans, signals)


def test_ok_episode_has_goal_answer_and_ordered_steps():
    ep = build([
        span(1, inp=user("Weather in Rome?")),
        span(2, op="execute_tool", tool="get_forecast", args='{"city":"Rome"}'),
        span(3, out=assistant("Sunny, 21C")),
    ])
    assert ep.outcome == "ok" and ep.value == 0.0 and ep.reasons == []
    assert ep.goal == "Weather in Rome?" and ep.answer == "Sunny, 21C"
    assert ep.steps == ["chat", "get_forecast", "chat"] and (ep.n_chat, ep.n_tools) == (2, 1)
    assert ep.decisive_span_id == ""


def test_error_in_tool_is_decisive_step_and_fails_the_episode():
    ep = build([
        span(1, inp=user("Weather?")),
        span(2, op="execute_tool", tool="get_forecast", args='{"city":""}', status="STATUS_CODE_ERROR",
             msg="city must not be empty (id 4821)", exc="ValueError"),
    ])
    assert ep.outcome == "failed" and ep.reasons == ["error_span"]
    assert (ep.decisive_step, ep.decisive_exception) == ("get_forecast", "ValueError")
    assert ep.decisive_error == "city must not be empty (id N)"


def test_parent_that_inherits_error_is_not_the_decisive_step():
    spans = [
        span(1, op="invoke_agent", parent="", status="STATUS_CODE_ERROR", msg="boom"),
        span(2, op="chat", parent="s1", status="STATUS_CODE_ERROR", msg="boom"),
        span(3, op="execute_tool", parent="s2", tool="geocode", status="STATUS_CODE_ERROR", msg="not found"),
    ]
    assert decisive_span(spans).span_id == "s3"


def test_repeated_identical_tool_call_is_a_loop_even_without_errors():
    call = dict(op="execute_tool", tool="search", args='{"q":"x"}')
    ep = build([span(1), span(2, **call), span(3, **call), span(4, **call)])
    assert ep.loop and "retry_loop" in ep.reasons and ep.outcome == "failed"


def test_repeated_model_error_is_a_loop_but_distinct_calls_are_not():
    ep = build([span(i, status="STATUS_CODE_ERROR", msg=f"429 quota {i}") for i in range(1, 4)])
    assert ep.loop
    varied = build([span(1), span(2, op="execute_tool", tool="a", args="1"), span(3, op="execute_tool", tool="a", args="2"),
                    span(4, op="execute_tool", tool="a", args="3")])
    assert not varied.loop


def test_silent_failures_without_any_error_span_are_caught_by_user_and_evaluator_signals():
    spans = [span(1), span(2)]
    down = build(spans, TraceSignals(thumbs_down=1))
    assert down.outcome == "failed" and down.reasons == ["thumbs_down"] and not down.has_error
    ep = build(spans, TraceSignals(thumbs_down=1, eval_scores=(0.0,)))
    assert ep.outcome == "failed" and ep.reasons == ["eval_failed", "thumbs_down"]


def test_positive_signals_lower_the_value_and_offset_a_loop():
    call = dict(op="execute_tool", tool="s", args="1")
    ep = build([span(1), span(2, **call), span(3, **call), span(4, **call)], TraceSignals(thumbs_up=1, eval_scores=(1.0,)))
    assert ep.value == 0.3 and ep.outcome == "suspect"


def test_mixed_thumbs_cancel_out_but_are_noted():
    ep = build([span(1)], TraceSignals(thumbs_up=1, thumbs_down=1))
    assert ep.thumbs == 0 and ep.value == 0.0 and ep.reasons == ["thumbs_mixed"]


def test_trace_without_model_or_tool_steps_has_no_episode():
    assert build([span(1, op="invoke_agent", parent="")]) is None


def test_messages_text_accepts_plain_text_parts_and_content_formats():
    assert messages_text("hola", "user") == "hola"
    assert messages_text(json.dumps([{"role": "user", "content": "a"}, {"role": "assistant", "content": "b"}]), "user") == "a"
    assert messages_text(user("x") , "assistant") == ""
    assert messages_text("[1, 2]", "user") == ""


def test_long_goal_is_truncated_and_version_is_exposed():
    ep = build([span(1, inp=user("a" * 2000))])
    assert len(ep.goal) == 500 and EPISODE_VERSION >= 1


def test_normalise_error_groups_numbers():
    assert normalise_error("status_code: 429, quota 17") == normalise_error("status_code: 503, quota 99")
