# Platform

The MemTrace platform stores the traces your agents emit and lets you explore them.

| Piece | What it does |
|---|---|
| **OpenTelemetry Collector** | Receives OTLP, batches with a persistent queue, writes to ClickHouse |
| **ClickHouse** | Columnar store for traces, fast aggregations |
| **Query API** | Next.js. The only access point to the data; handles login and authorization |
| **PostgreSQL** | Identity store: users, organizations, experiments, roles |
| **Dashboard** | Vue 3 SPA that only talks to the query API |

Start with [Run it locally](./getting-started), then see the [Dashboard](./dashboard) and [Organizations & roles](./access-control).
