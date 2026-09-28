# Organizations & roles

MemTrace is multi-tenant. An **organization** contains any number of **experiments**; an experiment is the traces and dashboard of one agent.

## Roles

| Role | Level | Can |
|---|---|---|
| `org_admin` | Organization | Admin of **all** experiments in the organization. Creates experiments, invites people as `org_admin` or directly to an experiment |
| `admin` | Experiment | Everything `member` can, plus invite others to that experiment |
| `member` | Experiment | Read traces, dashboard and metrics; create their own API key to instrument the agent |

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

## Agents

Agents authenticate with an [API key](/library/authentication) tied to an experiment, not with a user account.
