#!/usr/bin/env python3
"""Prueba la capa 2 de PII del Collector (ADR-084) contra k8s/40-otel-collector.yaml.

1. Estática (siempre): los tres bloques de `transform/pii` llevan los mismos patrones y cada patrón enmascara sus casos
   positivos y respeta los negativos (ids de traza, marcas de tiempo, versiones...).
2. De punta a punta (si OTELCOL_BIN apunta al binario `otelcol-contrib` de la misma versión que k8s/40): arranca el
   Collector real con esa configuración, le envía spans por OTLP/HTTP y comprueba lo que escribe.

    uv run --with pyyaml --with opentelemetry-sdk --with opentelemetry-exporter-otlp-proto-http scripts/check_collector_pii.py
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
MASK = "****"

POSITIVE = {
    "email": ["escribe a maria.garcia+x@example.co.uk ya"],
    "card_grouped": ["tarjeta 4111 1111 1111 1111 caduca", "4111-1111-1111-1111"],
    "card_plain": ["pago con 4111111111111111 ok", "amex 378282246310005"],
    "iban": ["IBAN ES9121000418450200051332 y", "ES91 2100 0418 4502 0005 1332"],
    "es_nif": ["mi DNI es 12345678Z.", "12345678-z"],
    "es_nie": ["NIE X1234567L", "y-1234567-a"],
    "us_ssn": ["SSN 123-45-6789"],
    "phone_intl": ["llama al +34 612 345 678 hoy", "+1 415 555 0132", "+44 20 7946 0958"],
    "phone_es": ["tel 612 345 678", "tel 612-34-56-78", "fijo 985.123.456"],
    "ipv4": ["desde 192.168.10.25 hacia", "ip 8.8.8.8"],
}
# Texto que NO debe tocarse: ids de traza/span, marcas de tiempo, versiones, importes, fechas.
NEGATIVE = [
    "4bf92f3577b34da6a3ce929d0e0e4736",
    "00f067aa0ba902b7",
    "1760000000000",
    "1760000000000000000",
    "version 1.2.3",
    "sdk 0.96.0 build 20260101",
    "total 1234.56 EUR",
    "2026-10-10T12:30:00Z",
    "pedido 612345678",
    "gen_ai.usage.input_tokens=15000",
    "The weather in San Francisco is sunny",
    "uuid 3f2504e0-4f89-11d3-9a0c-0305e82c3301",
]


def load_config() -> dict:
    cm = next(d for d in yaml.safe_load_all((ROOT / "k8s/40-otel-collector.yaml").read_text()) if d and d.get("kind") == "ConfigMap")
    return yaml.safe_load(cm["data"]["otel-collector-config.yaml"])


def ottl_regexes(statement: str) -> str:
    """El regex de un statement OTTL, ya con los escapes de la cadena Go resueltos (`\\\\d` -> `\\d`)."""
    m = re.search(r'"((?:[^"\\]|\\.)*)", "\*\*\*\*"\)$', statement)
    assert m, f"statement sin el formato esperado: {statement}"
    return m.group(1).replace("\\\\", "\\")


def static_checks(cfg: dict) -> list:
    blocks = cfg["processors"]["transform/pii"]["trace_statements"]
    per_block = [[ottl_regexes(s) for s in b["statements"]] for b in blocks]
    assert len(per_block) == 3, "se esperaban 3 bloques: atributos de span, status.message y atributos de evento"
    assert per_block[0] == per_block[1] == per_block[2], "los tres bloques deben llevar los mismos patrones, en el mismo orden"
    assert "transform/pii" in cfg["service"]["pipelines"]["traces"]["processors"]
    patterns = per_block[0]
    names = list(POSITIVE)
    assert len(patterns) == len(names), f"{len(patterns)} patrones y {len(names)} casos: añade casos para el patrón nuevo"
    for name, rx in zip(names, patterns):
        compiled = re.compile(rx)
        for text in POSITIVE[name]:
            assert compiled.search(text), f"{name}: no detecta {text!r}"
    for text in NEGATIVE:
        masked = text
        for rx in patterns:
            masked = re.sub(rx, MASK, masked)
        assert masked == text, f"falso positivo: {text!r} -> {masked!r}"
    return patterns


def end_to_end(binary: str) -> None:
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    from opentelemetry.trace import Status, StatusCode

    cfg = load_config()
    cfg.pop("extensions", None)
    cfg["service"].pop("extensions", None)
    out = tempfile.mkdtemp(prefix="otelcol-pii-")
    out_file = Path(out) / "traces.jsonl"
    cfg["receivers"]["otlp"]["protocols"] = {"http": {"endpoint": "127.0.0.1:43180"}}
    cfg["exporters"] = {"file": {"path": str(out_file)}}
    cfg["service"]["pipelines"]["traces"] = {"receivers": ["otlp"], "processors": ["transform/pii", "batch"], "exporters": ["file"]}
    cfg["service"]["telemetry"] = {"metrics": {"level": "none"}}
    cfg_path = Path(out) / "config.yaml"
    cfg_path.write_text(yaml.safe_dump(cfg))

    proc = subprocess.Popen([binary, "--config", str(cfg_path)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        time.sleep(3)
        if proc.poll() is not None:
            raise AssertionError("el Collector no arrancó:\n" + (proc.stdout.read() if proc.stdout else ""))
        provider = TracerProvider(resource=Resource.create({"service.name": "pii-check"}))
        provider.add_span_processor(SimpleSpanProcessor(OTLPSpanExporter(endpoint="http://127.0.0.1:43180/v1/traces")))
        tracer = provider.get_tracer("pii-check")
        with tracer.start_as_current_span("step") as span:
            span.set_attribute("memtrace.input", "soy Ana, mi DNI es 12345678Z y mi correo ana@example.com, IP 192.168.1.20")
            span.set_attribute("gen_ai.input.messages", json.dumps([{"role": "user", "content": "tarjeta 4111 1111 1111 1111"}]))
            span.set_attribute("trace.reference", "4bf92f3577b34da6a3ce929d0e0e4736")
            span.set_attribute("gen_ai.usage.input_tokens", 15000)
            span.add_event("exception", {"exception.message": "fallo al avisar a +34 612 345 678"})
            span.set_status(Status(StatusCode.ERROR, "no se pudo enviar a ana@example.com"))
        provider.shutdown()
        time.sleep(3)
    finally:
        proc.terminate()
        proc.wait(timeout=10)

    stored = out_file.read_text()
    for leaked in ("12345678Z", "ana@example.com", "192.168.1.20", "4111 1111 1111 1111", "612 345 678"):
        assert leaked not in stored, f"la PII llegó al exportador: {leaked}"
    assert stored.count(MASK) >= 6, "faltan máscaras en la salida"
    assert "4bf92f3577b34da6a3ce929d0e0e4736" in stored, "se enmascaró un id de traza"
    assert "15000" in stored, "se enmascaró un contador de tokens"
    print(f"  e2e OK: {stored.count(MASK)} máscaras, sin PII en la salida del Collector")


if __name__ == "__main__":
    patterns = static_checks(load_config())
    print(f"estático OK: {len(patterns)} patrones, mismos en los 3 bloques, {sum(map(len, POSITIVE.values()))} positivos y {len(NEGATIVE)} negativos")
    binary = os.environ.get("OTELCOL_BIN")
    if binary:
        end_to_end(binary)
    else:
        print("  e2e omitido (define OTELCOL_BIN=/ruta/a/otelcol-contrib v0.96.0 para ejecutarlo)")
    sys.exit(0)
