import json

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from memtrace.adapters.inbound.pydantic_ai.normalization import PydanticAiSpanNormalizer
from memtrace.adapters.outbound.otel.sanitizing_exporter import SanitizingSpanExporter
from memtrace.application import span_normalization
from memtrace.application.span_normalization import register_span_normalizer
from memtrace.domain.redaction import Redactor

ALL_MESSAGES = [
    {"role": "user", "parts": [{"type": "text", "content": "Holaa"}]},
    {"role": "assistant", "parts": [{"type": "text", "content": "¡Hola!"}], "finish_reason": "stop"},
]


@pytest.fixture(autouse=True)
def no_registered_normalizers(monkeypatch):
    monkeypatch.setattr(span_normalization, "_normalizers", [])


def _export(attributes: dict):
    memory = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(SanitizingSpanExporter(memory, Redactor())))
    with provider.get_tracer("pydantic-ai").start_as_current_span("invoke_agent agent") as span:
        for key, value in attributes.items():
            span.set_attribute(key, value)
    (exported,) = memory.get_finished_spans()
    return dict(exported.attributes)


def test_agent_span_gets_standard_input_output_and_usage():
    register_span_normalizer(PydanticAiSpanNormalizer())

    attrs = _export(
        {
            "pydantic_ai.all_messages": json.dumps(ALL_MESSAGES),
            "final_result": "¡Hola!",
            "gen_ai.aggregated_usage.input_tokens": 623,
            "gen_ai.aggregated_usage.output_tokens": 125,
        }
    )

    assert json.loads(attrs["gen_ai.input.messages"]) == [ALL_MESSAGES[0]]
    assert json.loads(attrs["gen_ai.output.messages"]) == [
        {"role": "assistant", "parts": [{"type": "text", "content": "¡Hola!"}]}
    ]
    assert attrs["gen_ai.usage.input_tokens"] == 623
    assert attrs["gen_ai.usage.output_tokens"] == 125


def test_existing_standard_attributes_are_never_overwritten():
    register_span_normalizer(PydanticAiSpanNormalizer())

    attrs = _export(
        {
            "pydantic_ai.all_messages": json.dumps(ALL_MESSAGES),
            "gen_ai.input.messages": '[{"role":"user","parts":[{"type":"text","content":"original"}]}]',
        }
    )

    assert attrs["gen_ai.input.messages"].count("original") == 1


def test_without_registered_normalizer_spans_are_untouched():
    attrs = _export({"pydantic_ai.all_messages": json.dumps(ALL_MESSAGES), "final_result": "x"})

    assert "gen_ai.output.messages" not in attrs


def test_no_content_means_nothing_is_derived():
    register_span_normalizer(PydanticAiSpanNormalizer())

    attrs = _export({"gen_ai.aggregated_usage.input_tokens": 10})

    assert "gen_ai.input.messages" not in attrs
    assert attrs["gen_ai.usage.input_tokens"] == 10


def test_derived_content_is_redacted_like_any_other_attribute():
    register_span_normalizer(PydanticAiSpanNormalizer())
    secret_prompt = [{"role": "user", "parts": [{"type": "text", "content": "mi clave sk-ant-api03-abcdefghijklmnopqrstuvwxyz"}]}]

    attrs = _export({"pydantic_ai.all_messages": json.dumps(secret_prompt)})

    assert "sk-ant-api03" not in attrs["gen_ai.input.messages"]
