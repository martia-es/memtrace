from memtrace.eval import contains, exact_match


def test_exact_match_true_when_equal():
    score = exact_match(output="4", expected_output="4")
    assert score.value is True and score.name == "exact_match"


def test_exact_match_false_when_different():
    score = exact_match(output="5", expected_output="4")
    assert score.value is False


def test_exact_match_without_expected_output_is_false_with_a_comment():
    score = exact_match(output="anything", expected_output=None)
    assert score.value is False
    assert score.comment


def test_contains_true_when_substring_present():
    score = contains(output="The answer is 4.", expected_output="4")
    assert score.value is True and score.name == "contains"


def test_contains_false_when_absent():
    score = contains(output="no clue", expected_output="4")
    assert score.value is False


def test_run_experiment_facade_records_one_trace_per_item_when_the_tracer_is_initialized():
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

    import memtrace
    from memtrace.eval import run_experiment

    exporter = InMemorySpanExporter()
    memtrace.shutdown()
    memtrace.init_tracer(span_exporter=exporter)
    try:
        result = run_experiment(data=[{"input": "a"}, {"input": "b"}], task=lambda *, item: item.input, evaluators=[], name="traced", sink=None)
        memtrace.flush()
        trace_ids = {r.trace_id for r in result.items}
        exported = {format(s.context.trace_id, "032x") for s in exporter.get_finished_spans() if s.name == "eval.item"}
        assert len(trace_ids) == 2 and trace_ids == exported
    finally:
        memtrace.shutdown()
