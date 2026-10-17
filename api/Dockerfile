# API de consulta de MemTrace. Contexto de build: api/   (docker build -t memtrace/api:dev api)
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm run build:worker && npm run build:ingest

# Servicio de ingesta (ADR-098): un solo archivo y nada más. Sin Next, sin credenciales de ClickHouse ni de login.
#   docker build --target ingest -t memtrace/ingest:dev api
FROM node:24-alpine AS ingest
WORKDIR /app
ENV NODE_ENV=production PORT=3002 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/dist-ingest/ingest.cjs ./ingest.cjs
USER 1000:1000
EXPOSE 3002
CMD ["node", "ingest.cjs"]

# Etapa por defecto (la última): la API de consulta
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
# `standalone` ya incluye las dependencias que necesita (también el driver de ClickHouse)
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# worker de /health (ADR-053): un solo archivo; lo ejecuta el CronJob `health-probe` con la misma imagen
COPY --from=build --chown=node:node /app/dist-worker/probe-health.cjs ./worker/probe-health.cjs
# worker de retención (ADR-084): lo ejecuta el CronJob `retention-purge`
COPY --from=build --chown=node:node /app/dist-worker/purge-traces.cjs ./worker/purge-traces.cjs
# worker de alertas y presupuestos (ADR-086): lo ejecuta el CronJob `alerts-evaluate`
COPY --from=build --chown=node:node /app/dist-worker/evaluate-alerts.cjs ./worker/evaluate-alerts.cjs
# backfill de ExperimentId (ADR-088): Job de una pasada con la misma imagen
COPY --from=build --chown=node:node /app/dist-worker/backfill-experiment-id.cjs ./worker/backfill-experiment-id.cjs
# cambio de otel_traces a su versión sin duplicados (ADR-099): Job `dedupe-otel-traces`, repetible
COPY --from=build --chown=node:node /app/dist-worker/dedupe-otel-traces.cjs ./worker/dedupe-otel-traces.cjs
# mantenimiento de otel_traces (compactar días cerrados, borrar la tabla anterior al cambio): CronJob `maintain-otel-traces`
COPY --from=build --chown=node:node /app/dist-worker/maintain-otel-traces.cjs ./worker/maintain-otel-traces.cjs
# uid de `node`; numérico para que Kubernetes pueda verificar runAsNonRoot
USER 1000:1000
EXPOSE 3001
CMD ["node", "server.js"]
