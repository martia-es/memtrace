from memtrace.application.experiment_runner import run_experiment
from memtrace.domain.evaluation import EvalItem, Score
import pytest

from memtrace.application.experiment_runner import ResultsUploadError
from tests.fakes import FakeDatasetSource, FakeIncrementalSink, FakeResultsSink

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


def test_run_experiment_reads_local_jsonl_and_json_files(tmp_path):
    from memtrace.eval import exact_match, run_experiment

    jsonl = tmp_path / "d.jsonl"
    jsonl.write_text('{"input": "a", "expected_output": "a"}\n\n{"input": "b", "expected_output": "x"}\n')
    as_json = tmp_path / "d.json"
    as_json.write_text('[{"input": "a", "expected_output": "a"}]')

    for path, expected_items in ((jsonl, 2), (as_json, 1)):
        result = run_experiment(data=path, task=lambda *, item: item.input, evaluators=[exact_match], name="local", sink=None)
        assert len(result.items) == expected_items


def test_run_experiment_rejects_dataset_version_without_dataset_id():
    import pytest

    from memtrace.eval import exact_match, run_experiment

    with pytest.raises(ValueError, match="dataset_version"):
        run_experiment(data=[{"input": "a"}], task=lambda *, item: "a", evaluators=[exact_match], name="x", dataset_version="1.0", sink=None)


def test_incremental_sink_gets_start_then_each_item_with_its_index_then_finish():
    sink = FakeIncrementalSink()
    result = run_experiment(data=ITEMS, task=_echo_task, evaluators=[_ExactMatch()], name="inc", sink=sink, max_workers=2)

    assert sink.events[0] == "start" and sink.events[-1] == "finish" and sink.events.count("add") == 2
    assert {index: r.item.input for index, r in sink.added} == {i: item.input for i, item in enumerate(ITEMS)}
    assert sink.finished == result
    assert [r.item.input for r in result.items] == [i.input for i in ITEMS]  # result stays in dataset order


def test_a_slow_item_does_not_hold_back_the_upload_of_the_others():
    import threading

    release_slow = threading.Event()
    uploaded_while_slow_blocked = []

    def task(*, item):
        if item.input == "2+2?":  # first item of the dataset
            release_slow.wait(timeout=5)
        return item.expected_output

    class Sink(FakeIncrementalSink):
        def add(self, index, item_result):
            super().add(index, item_result)
            if index != 0:
                uploaded_while_slow_blocked.append(index)
                release_slow.set()  # only now let the slow item finish

    result = run_experiment(data=ITEMS, task=task, evaluators=[], name="slow", sink=Sink(), max_workers=2)

    assert uploaded_while_slow_blocked == [1]  # item 1 was uploaded before item 0 finished
    assert [r.item.input for r in result.items] == [i.input for i in ITEMS]


def test_incremental_start_failure_aborts_before_any_agent_call():
    calls = []

    def task(*, item):
        calls.append(item)
        return item.expected_output

    with pytest.raises(RuntimeError, match="api down"):
        run_experiment(data=ITEMS, task=task, evaluators=[], name="x", sink=FakeIncrementalSink(fail_start=True))
    assert calls == []


def test_incremental_add_failure_does_not_stop_the_experiment():
    result = run_experiment(data=ITEMS, task=_echo_task, evaluators=[_ExactMatch()], name="x", sink=FakeIncrementalSink(fail_add=True))
    assert len(result.items) == 2


@pytest.mark.parametrize("sink", [FakeIncrementalSink(fail_finish=True)])
def test_a_failed_upload_raises_but_keeps_the_computed_result(sink):
    with pytest.raises(ResultsUploadError) as exc_info:
        run_experiment(data=ITEMS, task=_echo_task, evaluators=[_ExactMatch()], name="x", sink=sink)
    assert len(exc_info.value.result.items) == 2


def test_result_records_the_version_exposed_by_the_source():
    class VersionedSource(FakeDatasetSource):
        version = "2.1"

    result = run_experiment(data=VersionedSource(ITEMS), task=_echo_task, evaluators=[], name="v")
    assert result.dataset_version == "2.1"
    assert run_experiment(data=ITEMS, task=_echo_task, evaluators=[], name="v").dataset_version is None


def test_local_file_version_is_a_content_fingerprint(tmp_path):
    from memtrace.eval import run_experiment as facade_run

    path = tmp_path / "d.jsonl"
    path.write_text('{"input": "a"}\n')
    first = facade_run(data=path, task=lambda *, item: "a", evaluators=[], name="x", sink=None).dataset_version
    again = facade_run(data=path, task=lambda *, item: "a", evaluators=[], name="x", sink=None).dataset_version
    path.write_text('{"input": "b"}\n')
    edited = facade_run(data=path, task=lambda *, item: "a", evaluators=[], name="x", sink=None).dataset_version

    assert first.startswith("sha256:") and first == again and first != edited


def test_summary_aggregates_per_evaluator_locally():
    class Half:
        name = "half"

        def __call__(self, *, input):
            return Score(name=self.name, value=input == "2+2?", data_type="boolean")

    class Length:
        name = "length"

        def __call__(self, *, output):
            return Score(name=self.name, value=float(len(output)), data_type="numeric")

    result = run_experiment(data=ITEMS, task=_echo_task, evaluators=[Half(), Length()], name="s")
    by_name = {s.name: s for s in result.summary()}

    assert by_name["half"].pass_rate == 0.5 and by_name["half"].average is None and by_name["half"].count == 2
    assert by_name["length"].average == (1 + 5) / 2 and by_name["length"].pass_rate is None


def test_error_count_counts_items_whose_task_raised():
    def flaky(*, item):
        raise RuntimeError("boom")

    assert run_experiment(data=ITEMS, task=flaky, evaluators=[], name="e").error_count == 2


def test_offline_path_needs_neither_httpx_nor_the_http_adapter():
    """Local data + sink=None must never import the HTTP adapter or httpx (SDK decoupled from the API)."""
    import subprocess
    import sys
    import textwrap

    code = textwrap.dedent(
        """
        import sys
        sys.modules["httpx"] = None  # importing it would raise ImportError
        from memtrace.eval import run_experiment, exact_match
        r = run_experiment(data=[{"input": "a", "expected_output": "a"}], task=lambda *, item: item.input, evaluators=[exact_match], name="x", sink=None)
        assert r.summary()[0].pass_rate == 1.0
        assert "memtrace.adapters.outbound.http.eval_api_client" not in sys.modules
        """
    )
    subprocess.run([sys.executable, "-c", code], check=True)
