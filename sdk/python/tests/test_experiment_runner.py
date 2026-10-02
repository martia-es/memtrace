from memtrace.application.experiment_runner import run_experiment
from memtrace.domain.evaluation import EvalItem, Score
from tests.fakes import FakeDatasetSource, FakeResultsSink

ITEMS = [
    EvalItem(input="2+2?", expected_output="4"),
    EvalItem(input="capital of France?", expected_output="Paris"),
]


def _echo_task(*, item: EvalItem):
    return item.expected_output


class _ExactMatch:
    name = "exact_match"

    def __call__(self, *, output, expected_output):
        return Score(name=self.name, value=output == expected_output, data_type="boolean")


def test_happy_path_runs_task_and_evaluators_for_every_item():
    result = run_experiment(data=ITEMS, task=_echo_task, evaluators=[_ExactMatch()], name="smoke")

    assert result.name == "smoke"
    assert len(result.items) == 2
    for item_result in result.items:
        assert item_result.error is None
        assert item_result.scores == [Score(name="exact_match", value=True, data_type="boolean")]


def test_local_iterable_of_dicts_is_accepted_without_any_memtrace_dependency():
    data = [{"input": "hi", "expected_output": "hi"}]
    result = run_experiment(data=data, task=_echo_task, evaluators=[_ExactMatch()], name="dicts")
    assert result.items[0].scores[0].value is True


def test_a_dataset_source_port_is_accepted_directly():
    source = FakeDatasetSource(ITEMS)
    result = run_experiment(data=source, task=_echo_task, evaluators=[_ExactMatch()], name="via-port")
    assert len(result.items) == 2


def test_task_exception_fails_only_that_item_and_records_no_scores():
    def flaky_task(*, item: EvalItem):
        if item.input == "2+2?":
            raise RuntimeError("boom")
        return item.expected_output

    result = run_experiment(data=ITEMS, task=flaky_task, evaluators=[_ExactMatch()], name="flaky")

    failed = next(r for r in result.items if r.item.input == "2+2?")
    ok = next(r for r in result.items if r.item.input != "2+2?")
    assert failed.error == "boom"
    assert failed.scores == []
    assert ok.error is None
    assert ok.scores


def test_evaluator_exception_is_isolated_as_an_error_score_for_that_evaluator_only():
    class BrokenEvaluator:
        name = "broken"

        def __call__(self, *, output, expected_output):
            raise ValueError("evaluator is broken")

    result = run_experiment(
        data=ITEMS, task=_echo_task, evaluators=[BrokenEvaluator(), _ExactMatch()], name="isolation"
    )

    for item_result in result.items:
        names = {s.name for s in item_result.scores}
        assert names == {"broken", "exact_match"}
        broken_score = next(s for s in item_result.scores if s.name == "broken")
        assert broken_score.value == "evaluator is broken"


def test_sink_none_never_calls_a_sink():
    result = run_experiment(data=ITEMS, task=_echo_task, evaluators=[], name="no-sink", sink=None)
    assert result is not None  # nothing to assert on the sink side: there is none


def test_sink_is_called_once_with_the_full_result():
    sink = FakeResultsSink()
    result = run_experiment(data=ITEMS, task=_echo_task, evaluators=[_ExactMatch()], name="uploaded", sink=sink)
    assert sink.saved == [result]


def test_evaluator_only_receives_the_keyword_arguments_it_declares():
    seen = {}

    class MinimalEvaluator:
        name = "minimal"

        def __call__(self, *, output):
            seen["output"] = output
            return Score(name=self.name, value=True, data_type="boolean")

    run_experiment(data=ITEMS[:1], task=_echo_task, evaluators=[MinimalEvaluator()], name="minimal")
    assert seen == {"output": "4"}
