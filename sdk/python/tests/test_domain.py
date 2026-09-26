from memtrace.domain.attributes import llm_attributes, normalize_provider, step_start_attributes
from memtrace.domain.model import CapturePolicy, LlmCall


def test_provider_normalization_and_inference():
    assert normalize_provider("openai-chat") == "openai"
    assert normalize_provider("google_genai") == "gcp.gemini"
    assert normalize_provider(None, "claude-3-5") == "anthropic"
    assert normalize_provider(None, "desconocido") is None


def test_llm_attributes_total_tokens_and_none_values():
    attrs = llm_attributes(LlmCall(provider="openai", model="gpt-4o", input_tokens=3, output_tokens=4))
    assert attrs["gen_ai.usage.total_tokens"] == 7
    assert attrs["gen_ai.provider.name"] == "openai"
    assert attrs["gen_ai.request.temperature"] is None  # el adapter descarta los None


def test_step_start_attributes():
    a = step_start_attributes("tool", "s1")
    assert a["gen_ai.operation.name"] == "execute_tool" and a["gen_ai.conversation.id"] == "s1"
    assert step_start_attributes("custom")["gen_ai.operation.name"] is None


def test_capture_policy():
    assert CapturePolicy(enabled=False).apply({"a": 1}) is None
    assert CapturePolicy(enabled=True).apply({"a": 1}) == '{"a": 1}'
    assert CapturePolicy(enabled=True, max_length=5).apply("x" * 50).endswith("[truncated]")


def test_to_json_serializes_chat_messages_as_role_and_content():
    import json

    from memtrace.domain.serialization import to_json

    class Msg:
        type = "human"
        content = "hola"

    assert json.loads(to_json({"messages": [Msg()]})) == {"messages": [{"role": "human", "content": "hola"}]}
