# Dashboard de MemTrace servido por nginx, con proxy de /api hacia la API.
# Contexto de build: la RAÍZ del repo (necesita los tipos del contrato de la API, ADR-011):
#   docker build -f dashboard/Dockerfile -t memtrace/dashboard:dev .
FROM node:24-alpine AS build
WORKDIR /app/dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci
COPY dashboard/ ./
# alias `@contract` (solo tipos): ../api/src/adapters/inbound/http/contract.ts
COPY api/src/adapters/inbound/http/contract.ts /app/api/src/adapters/inbound/http/contract.ts
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
# Se rellena con las variables de entorno al arrancar (mecanismo de plantillas de la imagen oficial)
COPY dashboard/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY dashboard/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dashboard/dist /usr/share/nginx/html
ENV API_UPSTREAM=http://api:3001
EXPOSE 8080
