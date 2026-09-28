"""Optional anonymization of personal data (PII) before spans leave the process.

Plugs into `init_tracer(redact=...)`. `presidio_redactor` needs the `pii` extra
(`pip install 'memtrace-ai[pii]'`) plus a spaCy model; `text_hook` needs nothing.

    from memtrace import init_tracer
    from memtrace.pii import presidio_redactor

    init_tracer(redact=presidio_redactor(language="es"))

Secrets (API keys, passwords…) are masked by the SDK itself, with or without this module.
"""
import functools
import logging
import threading
from typing import Any, Callable, Iterable, Mapping, Optional, Sequence, cast

logger = logging.getLogger("memtrace")

# Precise entity types. Noisy ones (LOCATION, ORGANIZATION, DATE_TIME, NRP, URL, AGE, ID) are left
# out on purpose: they mask "San Francisco" or "tomorrow" and make traces useless. Ask for them
# explicitly with `entities=[...]` if you need them.
DEFAULT_ENTITIES = (
    "PERSON",
    "EMAIL_ADDRESS",
    "PHONE_NUMBER",
    "CREDIT_CARD",
    "IBAN_CODE",
    "IP_ADDRESS",
    "CRYPTO",
    "MEDICAL_LICENSE",
    "US_SSN",
    "US_PASSPORT",
    "US_ITIN",
    "US_DRIVER_LICENSE",
    "US_BANK_NUMBER",
    "UK_NHS",
    "ES_NIF",
    "ES_NIE",
)

# Spanish defaults to `md`: the `sm` model masks ordinary words such as "Hola" as people
DEFAULT_MODELS = {"en": "en_core_web_sm", "es": "es_core_news_md"}

_MAX_DEPTH = 64
_MIN_TEXT_LENGTH = 3
_CACHE_SIZE = 4096


def text_hook(transform: Callable[[str], str]) -> Callable[[Any], Any]:
    """Turns a `str -> str` function into a `redact` hook.

    The hook receives the content of a span as text or JSON-compatible data (dicts and lists of
    messages, tool arguments…); `transform` is applied to every string value found, and the
    structure is preserved. Dictionary keys are left untouched.
    """

    def walk(value: Any, depth: int = 0) -> Any:
        if isinstance(value, str):
            return transform(value)
        if depth >= _MAX_DEPTH:
            return value
        if isinstance(value, dict):
            return {k: walk(v, depth + 1) for k, v in value.items()}
        if isinstance(value, (list, tuple)):
            return [walk(v, depth + 1) for v in value]
        return value

    return walk


def presidio_redactor(
    language: str = "en",
    *,
    entities: Optional[Iterable[str]] = None,
    score_threshold: float = 0.4,
    models: Optional[Mapping[str, str]] = None,
    allow_list: Sequence[str] = (),
) -> Callable[[Any], Any]:
    """A `redact` hook that replaces personal data with `<ENTITY_TYPE>` using Microsoft Presidio.

    `language`: language of the text (`"en"` and `"es"` work out of the box; others need `models`).
    `entities`: Presidio entity types to mask; default `DEFAULT_ENTITIES` (those the language supports).
    `score_threshold`: minimum confidence (0-1) to mask a finding; raise it to mask less.
    `models`: `{language: spaCy model name}`; the defaults are `en_core_web_sm` and `es_core_news_md`.
        Larger models (`lg`, `trf`) recognize names better at the cost of memory and speed.
    `allow_list`: exact strings that must never be masked (your company or product name).

    Loads the model now, not at the first span, so a missing model fails at startup: raises
    ImportError if the `pii` extra is missing and RuntimeError if the spaCy model is not installed.
    Results are cached per text, so a conversation history resent on every turn is analyzed once.
    """
    try:
        import spacy.util
        from presidio_analyzer import AnalyzerEngine, RecognizerRegistry
        from presidio_analyzer.nlp_engine import NlpEngineProvider
        from presidio_anonymizer import AnonymizerEngine
    except ImportError as exc:
        raise ImportError("PII anonymization requires: pip install 'memtrace-ai[pii]'") from exc

    model = {**DEFAULT_MODELS, **(models or {})}.get(language)
    if model is None:
        raise ValueError(
            f"No spaCy model configured for language {language!r}; pass models={{{language!r}: '<model name>'}}"
        )
    if not spacy.util.is_package(model):
        # Presidio would silently download it on first use: fail loudly instead
        raise RuntimeError(f"spaCy model {model!r} is not installed; run: python -m spacy download {model}")

    nlp_engine = NlpEngineProvider(
        nlp_configuration={"nlp_engine_name": "spacy", "models": [{"lang_code": language, "model_name": model}]}
    ).create_engine()
    registry = RecognizerRegistry(supported_languages=[language])
    registry.load_predefined_recognizers(languages=[language], nlp_engine=nlp_engine)
    analyzer = AnalyzerEngine(nlp_engine=nlp_engine, registry=registry, supported_languages=[language])
    anonymizer = AnonymizerEngine()

    supported = set(analyzer.get_supported_entities(language))
    wanted = list(entities) if entities is not None else list(DEFAULT_ENTITIES)
    selected = [e for e in wanted if e in supported]
    if not selected:
        raise ValueError(f"None of the requested entities are supported for {language!r}: {sorted(supported)}")
    allowed = list(allow_list)
    lock = threading.Lock()  # spaCy pipelines are not guaranteed re-entrant

    @functools.lru_cache(maxsize=_CACHE_SIZE)
    def anonymize(text: str) -> str:
        if len(text) < _MIN_TEXT_LENGTH or not any(ch.isalnum() for ch in text):
            return text
        with lock:
            findings = analyzer.analyze(
                text=text,
                language=language,
                entities=selected,
                score_threshold=score_threshold,
                allow_list=allowed,
            )
            return anonymizer.anonymize(text=text, analyzer_results=cast(Any, findings)).text if findings else text

    logger.info("[MemTrace] PII anonymization ready (%s, model %s, %d entity types)", language, model, len(selected))
    return text_hook(anonymize)
