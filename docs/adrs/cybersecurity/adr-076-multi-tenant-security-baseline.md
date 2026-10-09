# ADR-076: Multi-Tenant Security Baseline

* **Status**: Pending
* **Date**: 2026-10-09
* **Deciders**: MemTrace Core Team
* **Related**: [ADR-013](../identity/adr-013-identity-postgres-and-oauth-rbac.md), [ADR-021](../sdk/adr-021-sdk-explicit-tracer-provider-and-content-redaction.md), [ADR-052](../identity/adr-052-permission-based-roles-and-external-identity-mapping.md)
* **Children**: [ADR-077](adr-077-strict-tenant-isolation-in-clickhouse.md), [ADR-078](adr-078-ingestion-identity-binding.md), [ADR-079](adr-079-network-segmentation-and-collector-access.md), [ADR-080](adr-080-client-boundary-for-multi-client-organizations.md)

## Context and Problem Statement

MemTrace is meant to be used by anyone, including a consultancy that manages the data and the agents of many clients in one installation. Traces contain prompts, completions and tool arguments, so a leak between clients is the worst failure the platform can have.

A security review of the current code (2026-10-09) found that identity and access control are solid for humans (federated login, permission-based roles, hashed API keys), but tenant isolation of the trace data, the ingestion path and the network have gaps that must be closed before a second real client shares an installation.

This ADR is the umbrella: it lists **what has to be addressed**, in what order, and which ADR owns each item. It decides nothing by itself; each child ADR carries its own decision. It moves to *Accepted* when all P0 items are implemented and verified.

## What we already comply with

| Area | Evidence |
|---|---|
| Federated login (Google/Microsoft), no passwords stored, database sessions | `api/src/auth.ts`, ADR-013 |
| Central permission check, 401/403/404 semantics | `authorization-service.ts`, `auth-context.ts`, ADR-052 |
| Agent API keys stored as SHA-256, shown once, revocable | migration `002_api_keys.sql` |
| SCIM tokens stored as hash; GitHub webhook HMAC with constant-time compare | migration 020, `github-webhook.ts` |
| Secrets masked in the SDK before export; content capture off by default; PII redaction opt-in | ADR-021, `docs-site/library/pii.md` |
| Identity store (Postgres) never sees trace content | ADR-013 |
| Retention: traces 30 days, evaluation text 180 days; `api_writer` with INSERT-only on evaluation tables | migrations ClickHouse 001/009, ADR-045 |
| Secrets out of git; same-origin dashboard (no CORS); Auth.js CSRF | `.gitignore`, nginx |

## What is missing

### P0 — before a second client shares an installation

| Item | Gap | Owner |
|---|---|---|
| Tenant isolation in ClickHouse | Data is scoped by `ServiceName`, which is unique only per organization | [ADR-077](adr-077-strict-tenant-isolation-in-clickhouse.md) |
| Ingestion identity binding | The gateway accepts any valid key for any `service.name` | [ADR-078](adr-078-ingestion-identity-binding.md) |
| Network segmentation | No `NetworkPolicy`; the Collector accepts OTLP from any pod without auth | [ADR-079](adr-079-network-segmentation-and-collector-access.md) |
| Client boundary | `org_admin` sees every experiment of the organization | [ADR-080](adr-080-client-boundary-for-multi-client-organizations.md) |

### P1 — before a public or enterprise launch (ADRs to write when scheduled)

| Item | Gap |
|---|---|
| Encryption in transit | No Ingress/TLS and no encryption between services; no HSTS, CSP or X-Frame-Options headers in nginx |
| Encryption at rest and secrets | Kubernetes secrets are base64; no volume encryption; no secret manager (ADR-013 left it open); no per-client keys |
| General audit log | Only partial audit (dataset items, prompt tag history, gate bypass). Missing: who read which trace, exports, role changes, logins, API key use |
| Rate limiting and quotas | `QueryLimiter` only bounds ClickHouse concurrency; nothing against abuse or brute force on API or ingestion, no per-tenant quota |
| Erasure and per-client retention | TTL is fixed for everyone; no delete-by-experiment/user/session; no data export |
| Server-side PII policy | Redaction happens only if the client configures the SDK; add an organization policy enforced at the gateway |
| Third-party data flows | LLM judges and the playground send content to external providers; inventory them and let an organization disable them |

### P2 — hardening and assurance

| Item | Gap |
|---|---|
| ClickHouse defense in depth | Row policies per tenant and a read-only user for the query API |
| Session policy | Configurable lifetime and idle timeout, email-domain restriction, SSO enforcement per organization |
| Supply chain | No dependency, image or SAST scanning and no SBOM in CI (4 workflows, none security-related) |
| Resilience | Encrypted backups, restore drill, automated cross-tenant isolation test in CI |
| Compliance | External pentest, DPA and sub-processor register, SOC 2 / ISO 27001 if selling to large companies |

## Decision Outcome

1. Security work is tracked as ADRs in this folder (`docs/adrs/cybersecurity/`), one per decision, all owned by this umbrella.
2. P0 items are implemented in the order of the table above, each in its own branch and with a cross-tenant test (see Verification).
3. No new feature that stores or reads tenant data may merge without the isolation test of ADR-077 covering it.

## Verification

This ADR is closed when:

- every P0 child ADR is *Accepted* and implemented;
- a CI test creates two organizations with the **same** `service.name` and proves neither can read, write or poison the other's data through the API, the gateway or the Collector;
- the P1 items are either scheduled with an owner or explicitly deferred with a reason.

## Consequences

- **Positive**: one place that answers "are we safe to host several clients?", with an honest list of gaps and an order.
- **Negative**: P0 changes touch the data model (ClickHouse key), the ingestion path and the deployment manifests at once; they need coordinated migrations and a rollout note for existing local data.
