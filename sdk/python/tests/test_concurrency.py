import asyncio
from concurrent.futures import ThreadPoolExecutor

import memtrace


async def test_concurrent_tasks_keep_isolated_sessions_and_parents(spans):
    @memtrace.trace_step(name="inner")
    async def inner(i):
        await asyncio.sleep(0.01)

    @memtrace.trace_step(name="outer")
    async def outer(i):
        with memtrace.session(f"conv-{i}"):
            await inner(i)

    await asyncio.gather(*(outer(i) for i in range(20)))

    finished = spans.get_finished_spans()
    by_id = {s.context.span_id: s for s in finished}
    inners = [s for s in finished if s.name == "inner"]
    assert len(inners) == 20
    for span in inners:
        parent = by_id[span.parent.span_id]
        assert parent.name == "outer" and span.context.trace_id == parent.context.trace_id
    assert {s.attributes["gen_ai.conversation.id"] for s in inners} == {f"conv-{i}" for i in range(20)}


def test_threads_do_not_leak_context_between_each_other(spans):
    @memtrace.trace_step(name="work")
    def work(i):
        with memtrace.session(f"t-{i}"):
            with memtrace.trace_step_context("child"):
                return memtrace.get_current_run_id()

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(work, range(40)))

    finished = spans.get_finished_spans()
    assert len({s.context.trace_id for s in finished if s.name == "work"}) == 40
    assert memtrace.get_current_run_id() is None
