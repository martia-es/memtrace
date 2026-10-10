import builtins
import json

import pytest
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

import memtrace
from memtrace.domain.serialization import REDACTED
from memtrace.pii import DEFAULT_ENTITIES, presidio_redactor, text_hook
from tests.conftest import by_name

# ----- text_hook: no extra needed -----


def test_text_hook_applies_to_every_string_and_keeps_structure():
    hook = text_hook(str.upper)
    payload = {"role": "user", "n": 3, "parts": [{"content": "hi"}, ("a", None)], "ok": True}
    assert hook(payload) == {"role": "USER", "n": 3, "parts": [{"content": "HI"}, ["A", None]], "ok": True}
    assert hook("plain") == "PLAIN"
    assert hook(7) == 7


def test_text_hook_leaves_dictionary_keys_alone():
    assert text_hook(lambda s: "X")({"email": "a@b.c"}) == {"email": "X"}


def test_text_hook_survives_absurd_nesting():
    value = current = []
    for _ in range(500):
        nested = []
        current.append(nested)
        current = nested
    assert text_hook(str.upper)(value) is not None


def test_text_hook_plugs_into_init_tracer(monkeypatch):
    memtrace.shutdown()
    monkeypatch.setenv("MEMTRACE_CAPTURE_CONTENT", "true")
    memory = InMemorySpanExporter()
    memtrace.init_tracer(span_exporter=memory, redact=text_hook(lambda s: s.replace("ana@x.io", "<email>")))

    @memtrace.trace_step(name="t", step_type="tool")
    def t(msg):
        return "reply to ana@x.io"

    t("mail ana@x.io")
    attrs = by_name(memory, "t").attributes
    assert "ana@x.io" not in attrs["gen_ai.tool.call.arguments"] and "<email>" in attrs["gen_ai.tool.call.result"]
    memtrace.shutdown()


def test_default_entities_skip_the_noisy_types():
    assert "PERSON" in DEFAULT_ENTITIES and "ES_NIF" in DEFAULT_ENTITIES
    assert not {"LOCATION", "ORGANIZATION", "DATE_TIME", "URL", "NRP"} & set(DEFAULT_ENTITIES)


# ----- errors that do not need Presidio -----


def test_missing_extra_raises_a_clear_import_error(monkeypatch):
    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name.startswith(("presidio_", "spacy")):
            raise ImportError(name)
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    with pytest.raises(ImportError, match=r"memtrace-ai\[pii\]"):
        presidio_redactor()


# ----- with Presidio + spaCy models installed -----

spacy_util = pytest.importorskip("spacy.util")
pytest.importorskip("presidio_analyzer")
pytest.importorskip("presidio_anonymizer")
needs_en = pytest.mark.skipif(not spacy_util.is_package("en_core_web_sm"), reason="en_core_web_sm not installed")
needs_es = pytest.mark.skipif(not spacy_util.is_package("es_core_news_md"), reason="es_core_news_md not installed")


@pytest.fixture(scope="module")
def en():
    return presidio_redactor("en")


@needs_en
def test_english_pii_is_replaced_by_asterisks(en):
    out = en("Hi, I'm John Smith, mail john.smith@example.com, phone +1 415 555 0132, card 4111 1111 1111 1111")
    for leaked in ("John Smith", "john.smith@example.com", "415 555 0132", "4111 1111 1111 1111"):
        assert leaked not in out
    assert out.count(REDACTED) >= 3 and "<" not in out


@needs_en
def test_structures_are_walked_and_harmless_text_is_untouched(en):
    out = en([{"role": "user", "content": "write to john.smith@example.com"}, {"role": "assistant", "content": "ok"}])
    assert out[0]["role"] == "user" and REDACTED in out[0]["content"] and out[1]["content"] == "ok"
    assert en({"n": 1, "t": "The weather is sunny"}) == {"n": 1, "t": "The weather is sunny"}


@needs_en
def test_noisy_entities_are_not_masked_by_default_but_can_be_requested(en):
    assert en("I live in San Francisco") == "I live in San Francisco"
    assert presidio_redactor("en", entities=["LOCATION"])("I live in San Francisco") == f"I live in {REDACTED}"


@needs_en
def test_allow_list_and_threshold():
    text = "Contact john.smith@example.com"
    assert presidio_redactor("en", allow_list=["john.smith@example.com"])(text) == text
    assert presidio_redactor("en", score_threshold=1.1)(text) == text


@needs_es
def test_spanish_national_ids_and_iban():
    out = presidio_redactor("es")("mi DNI es 12345678Z, correo maria@example.com, IBAN ES9121000418450200051332")
    assert "12345678Z" not in out and "maria@example.com" not in out and "ES9121000418450200051332" not in out
    assert REDACTED in out and "<" not in out


def test_unknown_language_needs_an_explicit_model():
    with pytest.raises(ValueError, match="No spaCy model configured for language 'xx'"):
        presidio_redactor("xx")


def test_uninstalled_model_fails_at_startup_with_the_fix():
    with pytest.raises(RuntimeError, match="python -m spacy download not_a_real_model"):
        presidio_redactor("en", models={"en": "not_a_real_model"})


def test_no_supported_entity_is_an_error():
    if not spacy_util.is_package("en_core_web_sm"):
        pytest.skip("en_core_web_sm not installed")
    with pytest.raises(ValueError, match="None of the requested entities"):
        presidio_redactor("en", entities=["ES_NIF"])


@needs_en
def test_end_to_end_only_anonymized_content_is_exported(monkeypatch):
    memtrace.shutdown()
    monkeypatch.setenv("MEMTRACE_CAPTURE_CONTENT", "true")
    memory = InMemorySpanExporter()
    memtrace.init_tracer(span_exporter=memory, redact=presidio_redactor("en"))

    @memtrace.trace_step(name="agent", step_type="agent")
    def agent(question):
        with memtrace.trace_step_context("llm", step_type="llm"):
            memtrace.trace_llm_call(
                "openai", "gpt-4o",
                input_messages=[{"role": "user", "content": question}],
                output_messages=[{"role": "assistant", "content": "Sure, I will email john.smith@example.com"}],
                input_tokens=12, output_tokens=9,
            )
        return "done for John Smith"

    with memtrace.session("conv-1"):
        agent("I'm John Smith, my card is 4111 1111 1111 1111 and my key is sk-abcdefghijklmnopqrstu")
    everything = " ".join(str(dict(s.attributes)) + str(s.events) for s in memory.get_finished_spans())
    for leaked in ("John Smith", "4111 1111", "john.smith@example.com", "sk-abcdefghij"):
        assert leaked not in everything
    llm = by_name(memory, "llm").attributes
    assert llm["gen_ai.usage.input_tokens"] == 12 and llm["gen_ai.conversation.id"] == "conv-1"
    assert json.loads(llm["gen_ai.input.messages"])[0]["role"] == "user"
    memtrace.shutdown()
