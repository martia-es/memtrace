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
RUN npm run build && npm run build:worker

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
# `standalone` ya incluye las dependencias que necesita (también el driver de ClickHouse)
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# worker de /health (ADR-053): un solo archivo; lo ejecuta el CronJob `health-probe` con la misma imagen
COPY --from=build --chown=node:node /app/dist-worker/probe-health.cjs ./worker/probe-health.cjs
# worker de retención (ADR-080): lo ejecuta el CronJob `retention-purge`
COPY --from=build --chown=node:node /app/dist-worker/purge-traces.cjs ./worker/purge-traces.cjs
# uid de `node`; numérico para que Kubernetes pueda verificar runAsNonRoot
USER 1000:1000
EXPOSE 3001
CMD ["node", "server.js"]
