# Worker de sincronización de calidad por modelo (ADR-025). Contexto de build: analytics/model_quality
# docker build -t localhost/memtrace/model-quality:dev analytics/model_quality
FROM python:3.11-slim AS build
WORKDIR /app
COPY pyproject.toml README.md ./
COPY model_quality ./model_quality
RUN pip install --no-cache-dir --prefix=/install .

FROM python:3.11-slim AS runtime
WORKDIR /app
COPY --from=build /install /usr/local
COPY model_quality ./model_quality
USER 1000:1000
ENTRYPOINT ["python", "-m", "model_quality.main"]
