# Public documentation site (docs.memtraces.ai): static VitePress build served by nginx.
# Independent from the dashboard and the API; build context is this folder:
#   docker build -t memtrace/docs:dev docs-site
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/.vitepress/dist /usr/share/nginx/html
EXPOSE 8080
