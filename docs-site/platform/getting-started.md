# Run it locally

The stack runs on a local Kubernetes cluster ([kind](https://kind.sigs.k8s.io/)).

## Requirements

- Docker or Podman (on macOS with Podman: `podman machine start`)
- `kind`
- `kubectl`

## Start

From the repository root:

```bash
make up
```

This creates the cluster, builds and loads the API and dashboard images, deploys everything, applies the database migrations, waits until it's healthy and forwards the ports.

| Service | Address |
|---|---|
| Dashboard | `http://localhost:8080` |
| OTLP/HTTP ingest (needs an API key) | `http://localhost:8080/api/v1/ingest` |
| ClickHouse Play UI | `http://localhost:8123/play` |

## Send your first traces

```bash
pip install -e sdk/python
export MEMTRACE_API_KEY=mtk_...   # Admin → experiment → API keys
make dev-data      # simulated agent sending traces through the ingest gateway
```

The dashboard refreshes on its own (every 5 seconds by default). To instrument your own agent, follow the [library quickstart](/library/quickstart).

## Commands

| Command | Description |
|---|---|
| `make up` | Bring up everything |
| `make status` | Pods, volumes and migration jobs |
| `make logs` | Collector logs |
| `make migrate` | Re-run database migrations |
| `make dashboard` / `make api` | Rebuild and redeploy only the dashboard or only the API |
| `make images` | Rebuild API and dashboard images and restart their pods |
| `make down` | Stop the cluster, keeping data |
| `make reset` | Delete the cluster **and its data** |

## Login setup

Sign-in uses Google or Microsoft (OIDC). Credentials are read from `k8s/secrets/identity-oauth.env` (not committed; see `k8s/secrets/README.md`). Invitation emails use [Resend](https://resend.com/) (`RESEND_API_KEY`, `EMAIL_FROM`); without them the invitation is recorded but no email is sent.
