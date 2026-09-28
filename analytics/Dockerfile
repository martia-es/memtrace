# Worker de extracción de temáticas (ADR-022). Contexto de build: analytics/   (docker build -t memtrace/topic-extraction:dev analytics)
FROM python:3.11-slim AS build
# gcc/g++ necesarios para compilar hdbscan (dependencia de BERTopic): no hay wheel prebuilt para todas las plataformas.
RUN apt-get update && apt-get install -y --no-install-recommends gcc g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml README.md ./
COPY topic_extraction ./topic_extraction
RUN pip install --no-cache-dir --prefix=/install .

FROM python:3.11-slim AS runtime
WORKDIR /app
COPY --from=build /install /usr/local
COPY topic_extraction ./topic_extraction
USER 1000:1000
ENTRYPOINT ["python", "-m", "topic_extraction.main"]
