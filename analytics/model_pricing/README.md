# analytics/model_pricing

Worker que sincroniza un catálogo de precios por modelo a ClickHouse, para poder convertir
tokens (`gen_ai.usage.*`) en coste en moneda (ver [ADR-025](../../docs/adrs/pricing/adr-025-model-pricing-catalog-sync.md)).

## Cómo funciona

`python -m model_pricing.main` descarga el JSON público de LiteLLM
(`model_prices_and_context_window.json`, mantenido por la comunidad y actualizado a diario)
y hace upsert de `(ModelId, Provider, InputPricePerToken, OutputPricePerToken)` en
`memtrace.model_pricing`. No hay fit ni estado local: cada corrida es una descarga + volcado
completo del catálogo.

## Programación

CronJob diario (`k8s/81-model-pricing-sync.yaml`) — los precios no cambian con frecuencia
suficiente como para justificar una sincronización más agresiva.

## Consultar precios

`memtrace.model_pricing` es `ReplacingMergeTree(UpdatedAt)`: para leer la versión vigente de
cada modelo hay que consultar con `FINAL` o `argMax(...)`, nunca leer la tabla a pelo (puede
haber filas duplicadas sin fusionar todavía).

## Variables de entorno

| Variable | Descripción |
|---|---|
| `CLICKHOUSE_HOST` / `CLICKHOUSE_PORT` / `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD` / `CLICKHOUSE_DATABASE` | Conexión a ClickHouse |
| `MODEL_PRICING_SOURCE_URL` | URL del JSON de precios, por defecto el catálogo de LiteLLM en GitHub |

## Limitación conocida

`ModelId` es el identificador que usa LiteLLM (p. ej. `claude-3-5-sonnet-20241022`,
`gpt-4o`), que no siempre coincide literalmente con `gen_ai.request.model` tal como lo emite
cada SDK/framework. Unir `otel_traces` con `model_pricing` para calcular coste real puede
necesitar normalizar ese nombre — no resuelto por este worker, que solo sincroniza el catálogo.
