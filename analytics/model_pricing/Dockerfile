# Worker de sincronización de precios de modelos (ADR-025). Contexto de build: analytics/model_pricing
# docker build -t localhost/memtrace/model-pricing:dev analytics/model_pricing
FROM python:3.11-slim AS build
WORKDIR /app
COPY pyproject.toml README.md ./
COPY model_pricing ./model_pricing
RUN pip install --no-cache-dir --prefix=/install .

FROM python:3.11-slim AS runtime
WORKDIR /app
COPY --from=build /install /usr/local
COPY model_pricing ./model_pricing
USER 1000:1000
ENTRYPOINT ["python", "-m", "model_pricing.main"]
