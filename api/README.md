# memtrace-api

API de consulta de MemTrace (pieza 4 del roadmap). Es el **único** punto de acceso a ClickHouse: el dashboard solo conoce su contrato HTTP/JSON. Diseño y contrato: [ADR-009](../docs/adrs/adr-009-query-api-contract.md).

## Arrancar

Con el stack levantado (`make up` en la raíz, que expone ClickHouse en `localhost:8123`):

```bash
cp .env.example .env.local   # ajusta si tu ClickHouse no es el del port-forward
npm install
npm run dev                  # http://localhost:3001
```

| Endpoint | |
|---|---|
| `GET /api/v1/traces` | listado paginado (`from,to,service,status,hasErrors,minDurationMs,limit,cursor`) |
| `GET /api/v1/traces/{traceId}` | traza con su árbol de spans |
| `GET /api/v1/conversations` | conversaciones (trazas con el mismo `gen_ai.conversation.id`), paginadas |
| `GET /api/v1/conversations/{id}` | resumen + turnos en orden cronológico |
| `GET /api/v1/metrics/overview` | totales, latencia, serie temporal, tokens por modelo y tools |
| `GET /api/v1/services` | servicios vistos en el rango |
| `GET /api/v1/health`, `/health/ready` | liveness / readiness |

Errores en `application/problem+json` (RFC 7807). Sin auth ni CORS en la fase 1: el dashboard accede por proxy del mismo origen.

## Arquitectura (hexagonal, como el SDK, ADR-008)

```
src/
  domain/                   tipos, buildSpanTree, extracción GenAI, rangos y métricas   (TS puro)
  application/              puerto TraceRepository + TraceQueryService (casos de uso)
  adapters/
    inbound/http/           validación zod, cursor, DTOs (contract.ts), errores RFC 7807
    outbound/clickhouse/    ClickHouseTraceRepository: el único sitio con SQL
  dependency-container.ts   composition root
  app/api/v1/**/route.ts    rutas de Next: finas, delegan en los handlers
```

La regla de dependencias la verifica `tests/architecture.test.ts`.

## Tests

```bash
npm test                    # dominio, servicio, HTTP y arquitectura (sin base de datos)
npm run test:integration    # contra el ClickHouse real; inserta datos sintéticos y los borra
npm run typecheck
```

## Configuración

| Variable | Defecto | |
|---|---|---|
| `CLICKHOUSE_URL` | `http://localhost:8123` | |
| `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD` | `default` / — | contraseña de desarrollo en el README raíz |
| `CLICKHOUSE_DATABASE` | `memtrace` | |
| `CLICKHOUSE_QUERY_MAX_THREADS` | `2` | hilos por consulta |
| `CLICKHOUSE_MAX_CONCURRENT_QUERIES` | `3` | consultas simultáneas por proceso |

> El ClickHouse local tiene un margen de hilos limitado (kind fija 307 PIDs por contenedor): ver [ADR-010](../docs/adrs/adr-010-clickhouse-thread-footprint-in-kind.md). Por eso la API limita hilos por consulta y concurrencia.
