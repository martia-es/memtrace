# Asistente RAG de FAQs. El contexto de build es la RAÍZ del repo (el SDK es una dependencia local):
#   docker build -f rag_assistant/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD) -t rag-assistant .
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

WORKDIR /srv
COPY sdk/python ./sdk/python
COPY rag_assistant ./rag_assistant
WORKDIR /srv/rag_assistant
RUN uv sync --no-dev --frozen

# Commit que se construye (ADR-065): lo rellena el CI en cada build. El SDK lo lee y lo pone en todas las trazas
# (`vcs.repository.ref.revision`), así cada traza dice con qué versión del código se generó.
ARG GIT_SHA
ENV GIT_SHA=$GIT_SHA

EXPOSE 8000
CMD ["uv", "run", "--no-sync", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
