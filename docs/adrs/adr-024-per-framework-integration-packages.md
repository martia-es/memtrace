# ADR-024: Per-Framework Integration Packages Under a Public `memtrace.<framework>` Namespace

* **Status**: Accepted
* **Date**: 2026-09-29
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

ADR-006 commits the SDK to being agnostic to the agent framework (LangChain, LangGraph, Pydantic AI, AutoGen, and others to come). Until now, each framework's integration lived as a flat pair of files under `adapters/inbound/` (`langchain.py` for the manual callback handler, `langchain_auto.py` for OTel auto-instrumentation; `pydantic_ai.py` for its own auto-instrumentation). Two problems surfaced when reviewing the SDK's structure:

1. **Naming did not scale.** `langchain.py` said nothing about *how* it integrates (manual callback vs. OTel auto-instrumentation); the distinction only existed in the filename suffix `_auto`. Adding AutoGen or CrewAI would mean inventing a new one-off filename convention each time.
2. **Import origin was not obvious.** All symbols were re-exported flat from `memtrace/__init__.py`, so `from memtrace import MemTraceCallbackHandler` gave no hint that it was LangChain-specific, and there was no shorter alternative to the internal hexagonal path (`memtrace.adapters.inbound.langchain`), which leaks implementation detail (`adapters.inbound`) into what should be public API.

## Decision Outcome

1. **One package per framework under `adapters/inbound/`**, with predictable submodule names instead of ad hoc filenames:
   ```
   adapters/inbound/langchain/{callback.py, auto.py}
   adapters/inbound/pydantic_ai/auto.py
   ```
   `callback.py` holds the manual integration (a callback handler or SDK hook the user attaches by hand); `auto.py` holds instrumentation that patches the framework globally via OpenTelemetry. Every future framework adapter follows this same pattern, so its shape is predictable without reading the code first.

2. **A public re-export module per framework at the top level**: `memtrace/langchain.py`, `memtrace/pydantic_ai.py`. These are the blessed import path for users:
   ```python
   from memtrace.langchain import MemTraceCallbackHandler, enable_langchain_instrumentation
   from memtrace.pydantic_ai import enable_pydantic_ai_instrumentation
   ```
   This keeps the internal hexagonal layout (`adapters/inbound/...`) out of the public surface, mirroring how `memtrace/pii.py` already exposes an optional feature as its own top-level module.

3. **`memtrace/__init__.py` keeps re-exporting the most common names** (`MemTraceCallbackHandler`, `enable_langchain_instrumentation`, `enable_pydantic_ai_instrumentation`) for backward compatibility and quick scripts, now sourced from the new public modules rather than the internal adapter paths.

4. **The framework-agnostic manual API gets the same one-file-per-concern treatment**: `adapters/inbound/decorators.py` (which mixed the `@trace_step` decorator, the `trace_step_context` context manager, and `trace_llm_call`) becomes `adapters/inbound/manual/{step.py, llm.py}`. Unlike the per-framework packages, this one has no dedicated `memtrace.<x>` public module — `trace_step`, `trace_step_context` and `trace_llm_call` are core primitives (like `init_tracer` or `session`), so they stay re-exported directly from `memtrace/__init__.py`.

## Consequences

* **Positive**: adding a new framework (AutoGen, CrewAI, LlamaIndex) means creating `adapters/inbound/<framework>/` with the same `callback.py` / `auto.py` shape and a matching `memtrace/<framework>.py`, no new naming decisions required. Import statements now state their own origin (`memtrace.langchain` vs `memtrace.pydantic_ai`).
* **Negative**: one more file per framework (the public re-export module); a purely cosmetic package-vs-module distinction to keep consistent going forward.
* **Compatibility**: `from memtrace import MemTraceCallbackHandler` (and the other top-level re-exports) keeps working unchanged.
