# ADR-053: Assistant Registry Data Model

* **Status**: Accepted — data model, permissions, API and dashboard screens implemented; health worker implemented; observed-connection sync pending
* **Date**: 2026-10-05
* **Deciders**: MemTrace Core Team
* **Amended by**: [ADR-054](adr-054-experiment-is-an-agent.md) — the card now lives on `experiments`; the `assistants` table and the registration step are gone
* **Depends on**: [ADR-013](../identity/adr-013-identity-postgres-and-oauth-rbac.md), [ADR-052](../identity/adr-052-permission-based-roles-and-external-identity-mapping.md)

## Context and Problem Statement

AI governance needs one place that shows every deployed assistant (one per experiment): name, description, owner, the MCP servers, tools and agents it uses, how it authenticates, its API per environment (DEV/PRE/PRO), whether that API is alive, and who may call it per environment. MemTrace already stores traces (ClickHouse) and identity (PostgreSQL) but nothing describes an assistant as a deployed product.

## Decision Outcome

### 1. Three kinds of data, three sources

| Kind | Examples | Where it lives |
|---|---|---|
| **Declared** | description, owner, API URLs, auth method, declared connections, access grants | PostgreSQL, written by people |
| **Observed** | tools, MCP servers and agents seen in spans; calls and error rate | ClickHouse (already there). PostgreSQL keeps only `first_seen_at` / `last_seen_at` and the governance decision |
| **Probed** | `/health` status, latency, uptime | PostgreSQL, written by a background worker |

Observed counters are computed at query time, never copied, so there is no second source of truth for metrics. A connection row exists because it was declared, seen, or both; **drift** is "seen and still `pending`".

### 2. Tables (migration `021_assistant_registry.sql`)

```
environments               (org, key, label, position, is_production, health_interval_seconds)
assistants                 (experiment_id PK → experiments, description, owner, lifecycle)
assistant_deployments      (experiment, environment, api_url, health_url?, version, auth_*, health_* current state)
deployment_health_checks   (deployment, checked_at, status, latency_ms, http_status, error)
assistant_connections      (experiment, kind: mcp_server|tool|agent, name, via?, peer_experiment?, declared, status, first/last_seen)
deployment_access_grants   (deployment, subject: user|group|everyone, user?, external_group?, source, member_count)
```

- **An assistant is its experiment** (amended by ADR-054): the card fields live on `experiments`, and every experiment is in the catalog. This ADR first kept them in an `assistants` table with an explicit registration step.
- **Environments are per organization**, seeded DEV/PRE/PRO (only PRO is production, 60 s probe; others 300 s). New organizations get them in `createOrganization`; the migration seeds existing ones. A deployment may override the interval.
- **Current health lives on the deployment** (fast cards and lists); **history is a separate table**, pruned by the worker (30 days). A pruning index is included.
- **No secrets, ever**: auth stores method, provider and audience only. `/health` is open by decision, so the probe sends no credentials.
- **Access grants reuse ADR-052's vocabulary**: `external_group` is the same identifier as `external_mappings.external_group`, and `source` is `manual | oidc | scim`. MemTrace documents and syncs who may call an environment; it does not enforce it (it is not the assistant's gateway).
- Tools carry the MCP server that exposes them (`via`, NULL = local function); agents may point to another catalog assistant (`peer_experiment_id`, NULL = not in the catalog).

### 3. Rules kept out of SQL

- The environment must belong to the same organization as the experiment: checked by the repository (a composite foreign key would force copying `organization_id` into `assistants`).
- **SSRF**: the server will call user-provided URLs. `isProbeableUrl` (domain) allows only http(s) without credentials; the worker additionally resolves DNS and refuses private, loopback and cloud-metadata addresses unless an organization allow-list says otherwise.
- Overall assistant status is the worst of its deployments (`overallStatus`); due checks and drift are pure functions in `domain/assistant-registry.ts`.

### 4. Permissions and API

Three permissions (migration `022`, catalogue in `domain/permissions.ts`, mirrored in the docs-site roles page):

| Permission | Scope | Allows |
|---|---|---|
| `governance:read` | organization | Catalog of assistants and each card (metadata only, no traces) |
| `governance:manage` | organization | Edit any card, approve or block connections, decide who can call each environment |
| `assistant:manage` | experiment | Maintain the card, deployments and declared connections of one's own assistant |

Roles: `org_admin` gets both governance permissions (it runs the organization and the catalog holds no data); `technical` gets `assistant:manage`; a new organization-level role `governance` has only the two governance permissions and is assigned through the IdP group mapping of ADR-052 (invitations by email stay `org_admin`-only for now). Routes accept a permission *or* another (`requireAnyPermission`): reading needs `governance:read` or `assistant:manage`, editing needs `assistant:manage` or `governance:manage`, and approvals and access grants need `governance:manage`, so an assistant's owner cannot approve their own tools or open their own access.

**Hardening that came with it**: `isOrgAdmin` returned true for *any* organization membership, which would have made a `governance` member an administrator. It now checks `org:manage` through the role's permissions (`hasOrganizationPermission`).

Endpoints (all under `/api/v1`): `GET organizations/:org/assistants` (catalog); `GET|POST|PATCH experiments/:id/assistant`, `GET …/assistant/environments`, `POST …/assistant/deployments`, `PATCH|DELETE …/deployments/:dep`, `GET …/deployments/:dep/health` (history), `GET|POST …/deployments/:dep/access`, `DELETE …/access/:grant`, `GET|POST …/assistant/connections`, `POST …/connections/sync`, `PATCH|DELETE …/connections/:conn`. Tool usage on connections comes from the existing metrics overview (last 7 days); MCP servers and agents are not measured yet (`usage: null`).

**Health probing rules** (domain, used by the future worker): 2xx within 1.5 s is `up`, slower 2xx `degraded`, anything else `down`; the current status only becomes `down` after two failures in a row, while the history keeps every raw result.

**Migration `023`** defers the deployment → environment foreign key to the end of the transaction: with an immediate check, deleting an organization that had deployed assistants failed before the cascade removed the deployments (found by the integration test).

### 5. Dashboard

Two screens, outside the experiment-scoped navigation (they belong to the organization): `/assistants` (the catalog) and `/assistants/:expId` (the card). The menu entry shows only to people with `governance:read` in some organization.

- **The catalog is cards, not a table**: each card is the assistant's introduction (status, environments, connections, who can call production). Severity changes the card's tint and border so what needs attention stands out without reading anything. The summary strip and filters are computed in the browser from the catalog response; it refreshes every 30 s.
- **The card page has two tabs** (`?tab=`): *Environments* (one box per deployment with 24 h of health bars and uptime, and below it who can call the selected environment) and *Connections* (MCP servers, tools and agents grouped, with origin — declared, seen, or both — usage, status and the governance actions).
- Buttons appear by permission, never by role name: owners with `assistant:manage` edit the card and deployments; only `governance:manage` shows approve/block and add/remove access.
- A new `AssistantApi` port with an HTTP adapter, separate from the trace and identity ports (another domain, another store). Presentation rules (headline status, uptime, origin of a connection) are pure functions in `domain/assistants.ts` with unit tests.

### 6. Health worker

A Kubernetes **CronJob** (`k8s/82-health-probe.yaml`, every minute) runs `worker/probe-health.cjs` from the API image: one pass lists the due deployments (`listDueDeployments`), probes them with a concurrency of 10 and records each result (`recordProbe`, which keeps the raw result in the history and applies the two-failures rule to the current status), and at 03:00 UTC prunes the history older than 30 days. A CronJob was chosen over a long-running process because the repository already uses them, it survives restarts without state and one minute is the shortest probe interval anyway (PRO). The worker is a single file bundled with esbuild (`npm run build:worker`) because the API image is a Next `standalone` server; `worker/` is its own composition root, like `dependency-container.ts`.

**SSRF** (found and fixed by tests while building it): the address check runs in the socket's own `lookup`, so a DNS that changes its answer between checking and connecting cannot bypass it; but Node never calls `lookup` for an IP literal, so a URL like `http://169.254.169.254/` skipped the guard — literals are now checked before opening the socket. Redirects are not followed (a 3xx is a failure) and the body is discarded. Private, loopback, CGNAT, multicast and reserved ranges are refused unless `HEALTH_PROBE_ALLOW_PRIVATE_NETWORKS=true` (set in the local cluster, where assistants run on the developer's machine); link-local and the cloud metadata address are never allowed. A per-organization allow-list is left for later.

**Observed tools** are synced by the same CronJob every 10 minutes (`syncAllObservedConnections`: one ClickHouse overview per active experiment, new tools stored as `pending`; the worker therefore also gets read-only ClickHouse credentials). Without it a card said *0 tools* for an agent that clearly had them until someone pressed *Find tools in traces*. `--sync` forces a pass (`kubectl create job --from=cronjob/health-probe`, overriding the command). Known imprecision: the overview has no timestamps, so `first_seen_at` / `last_seen_at` are the time of the sync that saw calls in the 7-day window, not of the span itself.

**Check now** (`POST …/deployments/:id/health/check`, `assistant:manage` or `governance:manage`) runs the same probe from the API, and returns the stored state untouched if the deployment was checked less than 10 s ago, so the button cannot be used to hammer an assistant. Verified end to end in the local cluster: a reachable `/health` became `up` (200 in 10 ms), an unresolvable host became `down` after two passes, and the metadata address was refused with the private-network flag on.

### 7. Not decided here

- The periodic sync of observed connections, and measuring MCP servers and agents from spans (see the findings below).
- Access synchronization with the identity provider beyond the `source` column, notifications on status change, per-organization probe allow-lists, and invitations to organization roles other than `org_admin`.

### 8. Findings: what spans say about MCP servers and agents (2026-10-05)

Looked at the real spans in ClickHouse (one service, 46 spans from the weather assistant: `chat`, `invoke_agent` and `execute_tool`):

- **Tools are observable today.** `execute_tool` spans carry `gen_ai.tool.name`, which is what the sync already uses.
- **MCP servers are not.** Pydantic AI's tool span (`capabilities/instrumentation.py`) only sets `gen_ai.operation.name`, `gen_ai.tool.name` and `gen_ai.tool.call.id`: a tool that comes from an MCP toolset is indistinguishable from a local function. There is no `mcp.*` attribute anywhere (the `server.address` that exists is the model provider's host, on `chat` spans). The weather assistant does not use MCP yet, so there was nothing to confirm either way.
- **Agents.** `gen_ai.agent.name` is on every span and is the assistant's *own* name; a second, different name only appears if another agent runs inside the trace. In Pydantic AI's agent-as-a-tool pattern that shows up as an `invoke_agent` span with a different `gen_ai.agent.name` under an `execute_tool` span, so peers called in-process can be derived from the span tree. A remote agent over the network leaves no trace of its own: only the tool span of the call.

Consequence: the sync cannot name MCP servers or remote agents from what is emitted now. The SDK has to stamp it (`memtrace.mcp_server` on the tool span of an MCP toolset, `memtrace.peer_agent` on calls to another agent), and then the sync reads those attributes next to the tool name.

## Consequences

- **Positive**: one registry, no duplicated metrics, hexagonal split preserved (pure domain rules, a port with a PostgreSQL adapter, routes that only map HTTP).
- **Positive**: environments and roles stay data, in line with ADR-052.
- **Negative**: health history in PostgreSQL grows with deployments × probes; pruning is mandatory and ClickHouse is the escape hatch if volume grows.
- **Negative**: a tool exposed by two MCP servers under the same name collapses into one row (`UNIQUE (experiment, kind, name)`); acceptable until it happens.
