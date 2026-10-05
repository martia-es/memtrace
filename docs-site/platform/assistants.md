# Assistants catalog

The catalog is the AI governance view of an organization: every agent (one per experiment) on a card that says what it is, who owns it, what it connects to, whether its API is alive in each environment and who may call it. It holds metadata only, never traces.

## Who sees it

| Permission | Where it comes from | What it gives |
|---|---|---|
| `governance:read` | `org_admin` or `governance` role in the organization | The **Assistants** entry in the menu, the catalog and every card |
| `governance:manage` | `org_admin` or `governance` | Edit any assistant's card, approve or block connections, decide who can call each environment |
| `assistant:manage` | `technical` role in the experiment | Maintain the card, deployments and declared connections of that one assistant |

The owner of an assistant cannot approve their own tools or open their own access: that is governance's decision. The `governance` role can be given from your identity provider like any other role (see [Organizations & roles](./access-control)).

## The catalog

**An experiment is an agent.** There is nothing to register: when you create an experiment, its card is already in the catalog, with you as its owner, and you can fill in its description right in the creation form. The catalog is simply the list of the organization's experiments. One card per experiment, with its overall status (the worst of its environments: an agent that is only in DEV and answers is **Healthy**; one with nothing deployed, or retired, is grey from badge to border), a box per environment (DEV, PRE, PRO by default) with the result of the last health check, the last 24 hours of checks as bars with the uptime, the names of its MCP servers, how many MCP servers, tools and agents it uses, the profile photos of the people in the experiment (technical first, then business; initials when someone has no photo), who can call the production API and how many connections wait for review. Who is shown is chosen by hand: they are the members of the experiment (Settings → experiment → Members, with the *technical* or *business* role), and the card page has a **Manage people** link for whoever can manage members. Cards with a degraded or failing environment stand out. Filter by name, description, environment or status, or show only the ones with issues. The page refreshes by itself every 30 seconds.

To add an agent, create an experiment in **Settings** (the **New agent** button of the catalog takes you there). An experiment that has no environments yet shows as *Not deployed* until you add its API.

## An assistant's card

**Environments.** One box per deployment with the API URL, version, how it authenticates, the last 24 hours of health checks and the uptime. MemTrace calls `GET /health` of each environment from the server: the endpoint must be open (no credentials) and answer `2xx`. A fast `2xx` is **Up**, a slow one (over 1.5 s) is **Degraded**, anything else is **Down**, and a deployment only turns Down after two failed checks in a row. A background job runs every minute and checks the environments that are due: production every minute and the other environments every five, unless you choose another interval. **Check now** on an environment checks it immediately (at most once every 10 seconds). The history is kept for 30 days. For safety, MemTrace refuses to call private networks, loopback and cloud metadata addresses, and does not follow redirects: an environment whose `/health` lives on your internal network needs your administrator to allow private networks for the job (`HEALTH_PROBE_ALLOW_PRIVATE_NETWORKS`). MemTrace stores how an API authenticates (API key, OAuth 2.0, mutual TLS), never the secret.

Below the boxes, **who can call** the selected environment: users, groups from your identity provider, or everyone in the organization. This is documentation and synchronization: MemTrace does not enforce it, because it is not the gateway of your assistant.

**Connections.** The MCP servers, tools and agents the assistant uses, each marked as declared, seen in traces, or both. Tools show their calls and error rate over the last 7 days. Anything seen in traces that nobody approved is flagged for review; governance approves or blocks it. MemTrace looks for the tools in the last 7 days of traces on its own, every 10 minutes, so a new tool shows up for review without anyone asking; *Find tools in traces* does the same right now. Servers and agents are not detected from traces yet: declare them.

**Talk to it.** Edit the agent and fill in **Chat endpoint**: the path of its chat (for example `/api/chat`). It is one path for the whole agent, the same in DEV, PRE and PRO; the host of each environment comes from its deployment, so each box shows the final chat URL. The agent also says in which JSON keys the message goes (default `message`), the answer comes back (default `reply`, or a dotted path such as `data.answer`) and, optionally, the conversation id (for example `session_id`, in the request and in the reply). Then every environment shows a **Talk** button that opens a small chat at the bottom right of MemTrace. It stays there while you move around the dashboard; minimize it, start a new conversation with ↺ or close it with ✕. Opening it on another environment starts a new conversation. MemTrace makes the call from its server (same network rules as the health checks) and does not keep the conversation. **Talk** only appears on environments whose API needs no credentials, because MemTrace does not store secrets. If the agent uses the SDK, each question is a normal trace.

## API

| Endpoint | Description |
|---|---|
| `GET /organizations/{organizationId}/assistants` | The catalog |
| `GET, PATCH /experiments/{experimentId}/assistant` | The card of an experiment; edit its description, owner, lifecycle or chat endpoint (`chat`: `path`, `requestField`, `responseField`, `sessionField`; `null` removes it) |
| `GET /experiments/{experimentId}/assistant/environments` | Environments of the organization |
| `POST /experiments/{experimentId}/assistant/deployments` | Deploy in an environment |
| `PATCH, DELETE /experiments/{experimentId}/assistant/deployments/{id}` | Edit or remove a deployment |
| `GET /experiments/{experimentId}/assistant/deployments/{id}/health` | Health check history (`hours`, `limit`) |
| `POST /experiments/{experimentId}/assistant/deployments/{id}/health/check` | Check now |
| `POST /experiments/{experimentId}/assistant/deployments/{id}/chat` | Talk to the agent in that environment: `{ message, sessionId }` → `{ reply, sessionId, latencyMs }` |
| `GET, POST /experiments/{experimentId}/assistant/deployments/{id}/access` | Who can call it; add access |
| `DELETE /experiments/{experimentId}/assistant/deployments/{id}/access/{grantId}` | Remove access |
| `GET, POST /experiments/{experimentId}/assistant/connections` | Connections with usage; declare one |
| `POST /experiments/{experimentId}/assistant/connections/sync` | Register the tools seen in traces |
| `PATCH, DELETE /experiments/{experimentId}/assistant/connections/{id}` | Approve or block; remove a declaration |
