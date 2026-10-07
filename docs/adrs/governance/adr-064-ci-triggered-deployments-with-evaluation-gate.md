# ADR-064: CI-Triggered Deployments with an Evaluation Gate

* **Status**: Proposed
* **Date**: 2026-10-07
* **Deciders**: MemTrace Core Team
* **Extends**: [ADR-053](adr-053-assistant-registry-data-model.md), [ADR-054](adr-054-experiment-is-an-agent.md)
* **Related**: [ADR-065](../observability/adr-065-code-revision-on-traces-and-evaluations.md), [ADR-028](../evaluation/adr-028-offline-evaluation-decoupled-sdk.md)

## Context and Problem Statement

The assistants tab shows where each agent is deployed (DEV/PRE/PRO) and whether it is healthy, but updating an environment happens outside MemTrace. The team wants a **Deploy** button per environment, with the agent's source repository linked to the card, and a guarantee that only code that passed an offline evaluation reaches an environment.

## Decision Outcome

### MemTrace triggers, the repo's CI/CD deploys

MemTrace never clones, builds or deploys. It **dispatches** the pipeline the team already owns (GitHub Actions `workflow_dispatch`, GitLab pipeline trigger, Bitbucket pipeline) and **observes** the result. Reasons: cloud credentials stay in the CI (secrets, OIDC) and never in MemTrace (consistent with ADR-053 and ADR-055); MemTrace does not become a second CI/CD product; every team keeps its own deployment logic (Kubernetes, Cloud Run, ECS, ...).

### Repository reference (on the agent, like `chat_path` in ADR-055)

- On `experiments`: `repo_url`, `repo_provider` (`github` | `gitlab` | `bitbucket`), `deploy_workflow` (workflow file or pipeline id).
- On `assistant_deployments` (or the environment): `deploy_ref` — the branch or tag deployed to that environment (`dev` → `develop`, `pro` → `main`).
- `repo_url` is validated like any outbound URL (https only, no credentials, host allow-list per provider).

### Access to the repository

One credential **per organization**, never a personal user token:

- GitHub: a **GitHub App** installed on the repos (permissions: Contents read, Actions write, Metadata read).
- GitLab / Bitbucket: a project/repository access token with the minimum scope to read and trigger pipelines.

Stored encrypted in PostgreSQL; the API never returns it. Rotation and revocation live in Admin.

### Deploy flow (the commit is never typed by hand)

1. The user presses **Deploy** on an environment.
2. MemTrace resolves `deploy_ref` to a commit SHA through the provider API.
3. **Gate**: there must be an offline evaluation run for **exactly that SHA** with a successful verdict (see below). Otherwise the request is rejected with `409` and a pointer to the missing/failed evaluation.
4. MemTrace dispatches the workflow passing `sha` and `environment` as inputs, and stores a `deploy_runs` row.
5. The workflow builds with that SHA ([ADR-065](../observability/adr-065-code-revision-on-traces-and-evaluations.md)) and deploys.
6. Status arrives by signed webhook (fallback: polling the provider run). `/health` probing (ADR-053) and the reported `version` confirm the deployment landed.

### What "successful evaluation" means

- Run `completed`, tagged with the commit SHA (ADR-065), commit present on the remote and no dirty working tree (`revision_dirty = false`).
- Every evaluator reaches its pass-rate target ([ADR-060](../evaluation/adr-060-per-evaluator-pass-rate-target.md)); the experiment may require more than one run in PRO (non-deterministic LLMs make a single pass evidence, not proof).
- Redeploying a commit that already deployed successfully (**rollback**) does not need a new evaluation.

### Emergency path

`org_admin` can deploy without a passing evaluation (hotfix) by giving a **mandatory reason**. The override is stored in `deploy_runs` (`gate_bypassed`, `bypass_reason`, user) and shown in the history.

### Permissions

New permission `deploy:run` (technical role, per [ADR-052](../identity/adr-052-permission-based-roles-and-external-identity-mapping.md)); PRO can additionally require approval by a second person (provider environment protection rules first, MemTrace approval later). Every attempt, allowed or not, is audited.

### Phase 1 (done): repository metadata

Migration `029_assistant_repo.sql`: `experiments.repo_url`, `repo_provider`, `deploy_workflow` (both-or-neither check on url/provider) and `assistant_deployments.deploy_ref`. The domain validates https, no credentials/query and that the host matches the provider; the card shows the repo link and each environment its branch. No credentials are stored yet.

### Phase 2b (done): the gate

`domain/deploy-gate.ts` (pure rule), `application/deploy-gate-service.ts` (gathers runs, aggregates and score configs; read-only) and `GET /experiments/{id}/assistant/deploy-gate?sha=` (`governance:read` or `assistant:manage`). Rules as implemented:

- Runs are matched to the commit by revision (a short SHA of at least 7 characters matches by prefix).
- Only `completed` runs with `revisionDirty != true` count; a commit with only dirty runs is `only_dirty_runs`, one with only running runs is `evaluation_running`, one with none is `no_evaluation`.
- A run passes when it has at least one boolean evaluator and every boolean evaluator reaches its target (`target_pass_rate` of its score config, ADR-060, default 80%); an evaluator with no results fails. Numeric and categorical evaluators do not decide.
- The **latest** `requiredRuns` clean runs must all pass (a later failure blocks, a later pass unblocks). `requiredRuns` is 1 for every environment for now; a per-environment value is a follow-up.
- A commit already deployed successfully is `rollback` and needs no evaluation. The deploy history does not exist yet, so the service takes it from an injectable function that returns nothing until `deploy_runs` (2c).

### Phase 2c (done): GitHub App, Deploy button and history

- **Port** `CiDispatcher` (`resolveRef`, `dispatch`) with `GithubAppDispatcher`: App JWT (RS256) → installation token per repo (cached) → resolve branch to SHA → `workflow_dispatch` with inputs `sha`, `environment`, `deploy_id`. Other providers answer "not supported yet" (503). `UnconfiguredDispatcher` when `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` are missing.
- **Credentials**: environment variables of the API (a Kubernetes Secret created by hand, optional), not the database. This replaces the "stored encrypted in PostgreSQL" idea above: one App per installation instead of per organization, and no key material in the database or in backups. Per-organization Apps remain possible later.
- **Correlation**: GitHub does not return the run id of a dispatch and the `workflow_run` webhook does not carry the inputs, so the workflow names its run `…deploy:<uuid>…` (`run-name`) and the webhook matches on that title. The webhook (`POST /api/v1/webhooks/github`) is authenticated by the HMAC-SHA256 signature only; without `GITHUB_WEBHOOK_SECRET` it rejects everything. A final status is never reopened.
- **Flow** (`DeployService`): requires repo, workflow and `deploy_ref` → no other deploy in progress for that environment (queued/running for less than an hour) → branch to SHA → gate → `deploy_runs` row → dispatch → `running` (or `failed` with the error). `GET .../deploy` previews the same without dispatching.
- **Permissions**: `deploy:run` (technical role, migration 031) or `governance:manage`. Skipping the gate needs `governance:manage` and a reason of 5–500 characters, stored with `gate_bypassed`.
- **Rollback**: `deploy_runs` now feeds the gate: a commit with a `succeeded` deployment is allowed without a new evaluation.
- **UI**: Deploy button per environment, a modal with the commit, the verdict, the failing evaluators and the bypass option, and *Last deploy* on the environment.
- **Not done**: GitLab and Bitbucket, approvals by a second person in PRO, promotion of the previous environment's commit, a rollback button, and a drift alert.

### Data model for deploys

`deploy_runs(id, deployment_id, commit_sha, ref, requested_by, evaluation_run_id, status, provider_run_url, gate_bypassed, bypass_reason, created_at, finished_at)`; `status` ∈ `queued | running | succeeded | failed | cancelled`.

### Rollout

1. Repo fields + link in the UI + SDK revision attribute ([ADR-065](../observability/adr-065-code-revision-on-traces-and-evaluations.md)). Metadata only, no risk.
2. Provider connection (GitHub first), gate, Deploy button, `deploy_runs` history and webhook status.
3. GitLab/Bitbucket, PRO approvals, promotion of the commit from the previous environment, rollback button, drift alert (deployed commit ≠ last recorded deploy).

### Reference implementation: the weather assistant

`weather_assistant/` is the first agent wired end to end, so the whole flow is exercised with a real app (ADR-047):

- `Dockerfile` with `ARG GIT_SHA` / `ENV GIT_SHA` (ADR-065), so its traces carry the commit.
- CI workflow on push/PR, filtered to `weather_assistant/**`, that runs `evals/run_eval.py` with `GITHUB_SHA` so each run is tagged with the commit it evaluated.
- Deploy workflow with `workflow_dispatch` inputs `sha` and `environment`: checks out that SHA, builds with `--build-arg GIT_SHA=<sha>` and deploys to the chosen environment.
- Registered in MemTrace with `repo_url`, `deploy_workflow` and `deploy_ref` per environment (`dev` → `develop`, `pro` → `main`); `/health` and `trace_id` in the chat reply already exist.
- The repo is a monorepo, so the workflows must run from `weather_assistant/` and must not fire for changes elsewhere.
- Open decision: where the demo deploys to (local k3d or a cloud target).

**Done (2.5)**: `weather_assistant/Dockerfile` (build verified; `GIT_SHA` reaches the SDK inside the image), `weather-assistant-eval.yml` (tests + evaluation of the commit, uploaded to MemTrace) and `weather-assistant-deploy.yml` (dispatch inputs `sha`, `environment`, `deploy_id`, `run-name` with the marker, build with the commit baked in). The final push-and-rollout step **fails on purpose** until the target is chosen, so MemTrace never reports "Deployed" for something nobody deployed. The root `.dockerignore` no longer excludes `sdk/` because this image needs it.

## Consequences

* (+) No deployment secrets in MemTrace; works with any infrastructure.
* (+) Every deployed commit has a linked, passing evaluation (or an audited exception).
* (−) Each repo needs a one-time workflow change (ADR-065); MemTrace generates the snippet.
* (−) Gate quality depends on dataset and evaluator quality; a weak dataset passes weak code.
* (−) The commit is not the whole version: prompts outside the repo, model changes and env vars can change behavior at the same SHA (see ADR-065, `config_hash`).
