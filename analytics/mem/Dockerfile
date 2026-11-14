# Worker de Mem: episodios por traza (Fase 2.0). Contexto de build: analytics/mem
# docker build -t localhost/memtrace/mem:dev analytics/mem
FROM python:3.11-slim AS build
WORKDIR /app
COPY pyproject.toml README.md ./
COPY mem ./mem
RUN pip install --no-cache-dir --prefix=/install .

FROM python:3.11-slim AS runtime
WORKDIR /app
COPY --from=build /install /usr/local
COPY mem ./mem
USER 1000:1000
ENTRYPOINT ["python", "-m", "mem.main"]
