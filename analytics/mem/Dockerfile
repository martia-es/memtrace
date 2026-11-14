# Workers de Mem. Contexto de build: analytics/mem. Dos imágenes desde el mismo código:
#   docker build --target episodes  -t localhost/memtrace/mem:dev analytics/mem             # episodios por traza (Fase 2.0), ligera
#   docker build --target discovery -t localhost/memtrace/mem-discovery:dev analytics/mem   # descubrimiento de reglas (Fase 2.1)
# La de descubrimiento lleva pandas, scikit-learn y el modelo de embeddings DENTRO de la imagen: el job no necesita Internet.

FROM python:3.11-slim AS build-episodes
WORKDIR /app
COPY pyproject.toml README.md ./
COPY mem ./mem
RUN pip install --no-cache-dir --prefix=/install .

FROM python:3.11-slim AS episodes
WORKDIR /app
COPY --from=build-episodes /install /usr/local
COPY mem ./mem
USER 1000:1000
ENTRYPOINT ["python", "-m", "mem.main"]

FROM python:3.11-slim AS build-discovery
WORKDIR /app
ENV HF_HOME=/opt/hf
COPY pyproject.toml README.md ./
COPY mem ./mem
# torch solo en CPU: la rueda por defecto de Linux arrastra CUDA (varios GB) y el job no tiene GPU
RUN pip install --no-cache-dir --prefix=/install torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir --prefix=/install ".[discovery]" --extra-index-url https://download.pytorch.org/whl/cpu
# el modelo de embeddings se descarga al construir, no al ejecutar
RUN PYTHONPATH=/install/lib/python3.11/site-packages python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')"

FROM python:3.11-slim AS discovery
WORKDIR /app
COPY --from=build-discovery /install /usr/local
COPY --from=build-discovery --chown=1000:1000 /opt/hf /opt/hf
COPY mem ./mem
ENV HF_HOME=/opt/hf HF_HUB_OFFLINE=1 NUMBA_CACHE_DIR=/tmp/numba-cache
USER 1000:1000
ENTRYPOINT ["python", "-m", "mem.discovery_main"]
