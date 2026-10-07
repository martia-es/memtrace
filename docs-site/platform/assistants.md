# Assistants catalog

The catalog is the AI governance view of an organization: every agent (one per experiment) on a card that says what it is, who owns it, what it connects to, whether its API is alive in each environment and who may call it. It holds metadata only, never traces.

## Who sees it

| Permission | Where it comes from | What it gives |
|---|---|---|
| `governance:read` | `org_admin` or `governance` role in the organization | The **Assistants** entry in the menu, the catalog and every card |
| `governance:manage` | `org_admin` or `governance` | Edit any assistant's card, approve or block connections, decide who can call each environment |
| `assistant:manage` | `technical` role in the experiment | Maintain the card, deployments and declared connections of that one assistant |
| `deploy:run` | `technical` role in the experiment | Deploy that assistant from MemTrace (skipping the evaluation gate also needs `governance:manage`) |

The owner of an assistant cannot approve their own tools or open their own access: that is governance's decision. The `governance` role can be given from your identity provider like any other role (see [Organizations & roles](./access-control)).

## The catalog

**An experiment is an agent.** There is nothing to register: when you create an experiment, its card is already in the catalog, with you as its owner, and you can fill in its description right in the creation form. The catalog is simply the list of the organization's experiments. One card per experiment, with its overall status (the worst of its environments: an agent that is only in DEV and answers is **Healthy**; one with nothing deployed, or retired, is grey from badge to border), a box per environment (DEV, PRE, PRO by default) with the result of the last health check, the last 24 hours of checks as bars with the uptime, the names of its MCP servers, how many MCP servers, tools and agents it uses, the profile photos of the people in the experiment (technical first, then business; initials when someone has no photo), who can call the production API and how many connections wait for review. Who is shown is chosen by hand: they are the members of the experiment (Settings → experiment → Members, with the *technical* or *business* role), and the card page has a **Manage people** link for whoever can manage members. Cards with a degraded or failing environment stand out. Filter by name, description, environment or status, or show only the ones with issues. The page refreshes by itself every 30 seconds.

To add an agent, create an experiment in **Settings** (the **New agent** button of the catalog takes you there). An experiment that has no environments yet shows as *Not deployed* until you add its API.

## An assistant's card

**Environments.** One box per deployment with the API URL, version, how it authenticates, the last 24 hours of health checks and the uptime. MemTrace calls `GET /health` of each environment from the server: the endpoint must be open (no credentials) and answer `2xx`. A fast `2xx` is **Up**, a slow one (over 1.5 s) is **Degraded**, anything else is **Down**, and a deployment only turns Down after two failed checks in a row. A background job runs every minute and checks the environments that are due: production every minute and the other environments every five, unless you choose another interval. **Check now** on an environment checks it immediately (at most once every 10 seconds). The history is kept for 30 days. For safety, MemTrace refuses to call private networks, loopback and cloud metadata addresses, and does not follow redirects: an environment whose `/health` lives on your internal network needs your administrator to allow private networks for the job (`HEALTH_PROBE_ALLOW_PRIVATE_NETWORKS`). MemTrace stores how an API authenticates (API key, OAuth 2.0, mutual TLS), never the secret.

Below the boxes, **who can call** the selected environment: users, groups from your identity provider, or everyone in the organization. A *group* is a group name or id from your identity provider (the same one you mapped in Settings → Identity). To add a *person*, search the organization by name or email: each result shows their photo. This is documentation and synchronization: MemTrace does not enforce it, because it is not the gateway of your assistant.

**Connections.** The MCP servers, tools and agents the assistant uses, each marked as declared, seen in traces, or both. Tools and MCP servers show their calls and error rate over the last 7 days (a server's numbers add up its tools). Anything seen in traces that nobody approved is flagged for review; governance approves or blocks it. MemTrace looks for tools and MCP servers in the last 7 days of traces on its own, every 10 minutes, so a new one shows up for review without anyone asking; *Find tools in traces* does the same right now. A server is detected when the SDK names it on the tool spans (see [Tracing steps](../library/tracing#mcp-tools)). Agents are not detected from traces yet: declare them.

**Talk to it.** Edit the agent and fill in **Chat endpoint**: the path of its chat (for example `/api/chat`). It is one path for the whole agent, the same in DEV, PRE and PRO; the host of each environment comes from its deployment, so each box shows the final chat URL. The agent also says in which JSON keys the message goes (default `message`), the answer comes back (default `reply`, or a dotted path such as `data.answer`) and, optionally, the conversation id (for example `session_id`, in the request and in the reply). Then every environment shows a **Talk** button that opens a small chat at the bottom right of MemTrace. It stays there while you move around the dashboard; minimize it, start a new conversation with ↺ or close it with ✕. Opening it on another environment starts a new conversation. MemTrace makes the call from its server (same network rules as the health checks) and does not keep the conversation. **Talk** only appears on environments whose API needs no credentials, because MemTrace does not store secrets. If the agent uses the SDK, each question is a normal trace. Optionally, fill in **Trace id field** with the key of the answer that carries the id of its trace (for example `trace_id`, from `memtrace.current_trace_id()`): then each answer in the chat gets 👍/👎 and the vote is saved on that trace, as [user feedback](/library/feedback). Pressing the other button changes your vote.

**Repository.** Edit the agent and fill in **Source repository**: the provider (GitHub, GitLab or Bitbucket), the repository URL and, optionally, the workflow that deploys it. The URL must be `https://`, without credentials, and its host must match the provider. The link shows on the assistant's page. On each deployment you can also set the **branch or tag to deploy** (for example `develop` in DEV and `main` in PRO); it shows as *Deploys from* on its box. Under the description, **Show the code version on every trace** gives the two lines to add to your Dockerfile and CI so each trace carries the commit that produced it (see [Configuration](../library/configuration#code-version-on-every-trace)); with the repository declared, that version links to the commit in your repository, in the trace, in the traces list and in each evaluation run. 

**Deploy.** With the repository, the workflow and the branch of an environment filled in, that environment shows a **Deploy** button. MemTrace does not build or deploy anything: it asks GitHub Actions to run *your* workflow, and your workflow does the work. Pressing it shows the branch, the commit it points to today and whether that commit has a passing offline evaluation (see the *deploy gate* below). If it does, **Deploy** starts the workflow; the environment then shows the last deployment (*Deployed · 3a08213 · 5 minutes ago*) as GitHub reports it. Only one deployment per environment can be in progress.

The **gate**: a commit can only be deployed if the evaluation run from your CI on exactly that commit passed, with every boolean evaluator at its target (80% unless its score config says otherwise). Evaluations run on a laptop with uncommitted changes do not count, and going back to a commit that was already deployed successfully does not need a new evaluation. In an emergency, a person with the governance permission can tick *Deploy anyway* and write why; the reason stays in the deployment history.

Your workflow must accept three inputs and name its run after the last one, so MemTrace can match GitHub's result with the deployment:

```yaml
on:
  workflow_dispatch:
    inputs:
      sha: { required: true }
      environment: { required: true }
      deploy_id: { required: true }
run-name: Deploy ${{ inputs.deploy_id }} to ${{ inputs.environment }}
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { ref: "${{ inputs.sha }}" }
      - run: docker build --build-arg GIT_SHA=${{ inputs.sha }} -t my-assistant .
      # …push the image and deploy it to ${{ inputs.environment }}
```

Deploying from MemTrace works with GitHub for now, and your administrator must set it up once (the full step-by-step guide, including the public address for local use, is [Set up deploys from MemTrace](./deploy-setup)): create a GitHub App with *Contents: read*, *Actions: write* and *Metadata: read*, install it on the repositories of your assistants and point its webhook (event *Workflow runs*) to `/api/v1/webhooks/github`. Its credentials live in the server's environment (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`), never in the database or the browser. Without them everything else works and **Deploy** says it is not configured.

## API

| Endpoint | Description |
|---|---|
| `GET /organizations/{organizationId}/assistants` | The catalog |
| `GET, PATCH /experiments/{experimentId}/assistant` | The card of an experiment; edit its description, owner, lifecycle or chat endpoint (`chat`: `path`, `requestField`, `responseField`, `sessionField`; `null` removes it) |
| `GET /experiments/{experimentId}/assistant/deploy-gate?sha=` | Can this commit be deployed? Answers `allowed`, and a `verdict` (`allowed`, `rollback`, `no_evaluation`, `evaluation_running`, `only_dirty_runs`, `failed`, `insufficient_runs`) with the reason and the evaluations that were checked. A commit can be deployed when its latest offline evaluation, run from the CI on that exact commit, reaches the pass-rate target of every boolean evaluator (80% unless the evaluator's score config says otherwise). Evaluations run with uncommitted changes do not count |
| `GET, POST /experiments/{experimentId}/assistant/deployments/{id}/deploy` | `GET`: the branch, the commit it points to and the gate's verdict, without deploying. `POST { bypassReason? }`: start the deployment (`202`); `409` with the gate's verdict if the commit cannot be deployed; `503` if GitHub is not configured |
| `GET /experiments/{experimentId}/assistant/deployments/{id}/deploys` | Deployment history of an environment, newest first (`limit`) |
| `GET /experiments/{experimentId}/assistant/environments` | Environments of the organization |
| `POST /experiments/{experimentId}/assistant/deployments` | Deploy in an environment |
| `PATCH, DELETE /experiments/{experimentId}/assistant/deployments/{id}` | Edit or remove a deployment |
| `GET /experiments/{experimentId}/assistant/deployments/{id}/health` | Health check history (`hours`, `limit`) |
| `POST /experiments/{experimentId}/assistant/deployments/{id}/health/check` | Check now |
| `POST /experiments/{experimentId}/assistant/deployments/{id}/chat` | Talk to the agent in that environment: `{ message, sessionId }` → `{ reply, sessionId, latencyMs }` |
| `GET, POST /experiments/{experimentId}/assistant/deployments/{id}/access` | Who can call it; add access |
| `DELETE /experiments/{experimentId}/assistant/deployments/{id}/access/{grantId}` | Remove access |
| `GET /experiments/{experimentId}/assistant/people?q=` | Find people of the organization by name or email (needs governance) |
| `GET, POST /experiments/{experimentId}/assistant/connections` | Connections with usage; declare one |
| `POST /experiments/{experimentId}/assistant/connections/sync` | Register the tools and MCP servers seen in traces |
| `PATCH, DELETE /experiments/{experimentId}/assistant/connections/{id}` | Approve or block; remove a declaration |
