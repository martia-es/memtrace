# Platform

The MemTrace platform stores the traces your agents emit and lets you explore them.

| Piece | What it does |
|---|---|
| **OpenTelemetry Collector** | Receives OTLP, batches with a persistent queue, writes to ClickHouse |
| **ClickHouse** | Columnar store for traces, fast aggregations |
| **Query API** | Next.js. The only access point to the data; handles login and authorization |
| **PostgreSQL** | Identity store: users, organizations, experiments, roles |
| **Dashboard** | Vue 3 SPA that only talks to the query API |

<div class="mt-cards">
  <a class="mt-card" href="./getting-started"><span class="mt-card-tag">Start</span><strong>Run it locally</strong><span>Bring up the whole stack with Docker.</span></a>
  <a class="mt-card" href="./dashboard"><span class="mt-card-tag">Explore</span><strong>Dashboard</strong><span>Conversations, traces and spans.</span></a>
  <a class="mt-card" href="./access-control"><span class="mt-card-tag">Access</span><strong>Organizations & roles</strong><span>Who can see and do what.</span></a>
  <a class="mt-card" href="./evaluation"><span class="mt-card-tag">Quality</span><strong>Datasets & offline evals</strong><span>Compare experiments over datasets.</span></a>
  <a class="mt-card" href="./annotations"><span class="mt-card-tag">Quality</span><strong>Annotations & review</strong><span>Review queues and labels.</span></a>
  <a class="mt-card" href="./api"><span class="mt-card-tag">Reference</span><strong>Query API</strong><span>HTTP endpoints behind the dashboard.</span></a>
  <a class="mt-card" href="./data-model"><span class="mt-card-tag">Reference</span><strong>Data model</strong><span>Every table, how they relate and why.</span></a>
  <a class="mt-card" href="./roles-and-permissions"><span class="mt-card-tag">Reference</span><strong>Roles & permissions</strong><span>The permission matrix and a simulator.</span></a>
</div>
