"""Regla de dependencias hexagonal: el núcleo no conoce tecnologías ni adapters."""
import ast
from pathlib import Path

import memtrace

ROOT = Path(memtrace.__file__).parent
FORBIDDEN = {
    "domain": ("opentelemetry", "langchain_core", "memtrace.application", "memtrace.adapters", "memtrace.dependency_container"),
    "application": ("opentelemetry", "langchain_core", "memtrace.adapters", "memtrace.dependency_container"),
    "adapters/inbound": ("opentelemetry", "memtrace.adapters.outbound"),
}


def _imports(path):
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.Import):
            yield from (a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            yield node.module


def test_layers_respect_dependency_rule():
    violations = []
    for layer, banned in FORBIDDEN.items():
        for file in (ROOT / layer).rglob("*.py"):
            for mod in _imports(file):
                # el adapter de LangChain sí puede importar langchain_core
                if layer == "adapters/inbound" and mod == "langchain_core":
                    continue
                if mod.startswith(banned):
                    violations.append(f"{file.relative_to(ROOT)} importa {mod}")
    assert not violations, "\n".join(violations)
