# Organizations & roles

MemTrace is multi-tenant. An **organization** contains any number of **experiments**; an experiment is the traces and dashboard of one agent.

## Roles

| Role | Level | Can |
|---|---|---|
| `org_admin` | Organization | Admin of **all** experiments in the organization. Creates experiments, invites people as `org_admin` or directly to an experiment |
| `admin` | Experiment | Everything `member` can, plus invite others to that experiment and manage score configs and review queues |
| `member` | Experiment | Read traces, dashboard and metrics; create their own API key to instrument the agent; annotate traces and review [queues](/platform/annotations#review-queues) |

Access to an experiment = `org_admin` of its organization **or** a direct membership in it.

## Getting started

1. Sign in with Google or Microsoft. There are no passwords; the first login creates your account.
2. Any signed-in user can create an organization and becomes its first `org_admin`.
3. An `org_admin` creates experiments inside it.

## Inviting people

Invite by email, even if the person has never signed in. If they already have an account the role applies immediately (`201`); otherwise the invitation is pending (`202`), an email is sent, and the role applies on their first login.

```bash
# As org_admin of an organization
curl -X POST $API/api/v1/organizations/{organizationId}/members \
  -H "Content-Type: application/json" \
  -d '{"email": "new.person@company.com"}'

# As admin or member of an experiment
curl -X POST $API/api/v1/experiments/{experimentId}/members \
  -H "Content-Type: application/json" \
  -d '{"email": "new.person@company.com", "role": "member"}'
```

## Agent API keys

Agents authenticate with an API key tied to one experiment, not with a user account. An `admin` of the experiment, or an `org_admin`, creates keys in **Admin → organization → experiment → API keys** (the **Connect** tab walks through the setup), or with `POST /api/v1/experiments/{experimentId}/api-keys`.

- Keys look like `mtk_Ab3xY9...`. The plaintext is shown **once**; only its hash is stored.
- A key works for OTLP ingestion and for the evaluation endpoints of its own experiment. It does not reach any other experiment.
- An invalid or revoked key is rejected with `401`. Revoke a key with `DELETE /api/v1/experiments/{experimentId}/api-keys/{keyId}`.
- The ingest gateway checks that the key is valid. It does not check that the `service.name` of the traces matches the key's experiment.

How the SDK sends the key is in [Authentication](/library/authentication).
