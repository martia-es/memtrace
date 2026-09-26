# ADR 019: Python Package Name `memtrace-ai`

## Status
Accepted

## Context

The original Python distribution name `memtrace` is already taken on PyPI, so the SDK cannot be published under that name without colliding with an existing project.

The repository and import namespace already use `memtrace` internally, and keeping those names avoids unnecessary churn in the Python API.

## Decision

Publish the Python SDK to PyPI as `memtrace-ai` while keeping the Python import path as `memtrace`.

The package metadata in `sdk/python/pyproject.toml` uses `name = "memtrace-ai"`, and the SDK documentation should tell users to install `memtrace-ai` from PyPI.

## Consequences

- The public installation command becomes `pip install memtrace-ai`.
- Existing Python code continues to import from `memtrace`.
- The GitHub Actions publish workflow stays the same because the trusted publisher is tied to the repository and workflow, not to the distribution name.

## Alternatives Considered

- Keep `memtrace` on PyPI. Rejected because the name is already taken.
- Rename the Python import namespace to `memtrace_ai`. Rejected because it would add churn without solving the PyPI collision.
