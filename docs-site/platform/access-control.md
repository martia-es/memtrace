# Organizations & roles

MemTrace is multi-tenant. An **organization** contains any number of **experiments**; an experiment is the traces and dashboard of one agent.

## Roles

| Role | Level | Can |
|---|---|---|
| `org_admin` | Organization | Creates experiments, invites people (as `org_admin` or into an experiment with a role) and sees and revokes every API key. **Does not read traces or the dashboard**: to work in an experiment they also need a `technical` or `business` role there. The person who creates an experiment is added to it as `technical` |
| `technical` | Experiment | The whole dashboard, including the technical trace, plus everything that shapes the review: create [queues](/platform/annotations#review-queues), manage rubrics (score configs), see every reviewer's answers, settle disagreements, build datasets, and create their own API key |
| `business` | Experiment | The whole dashboard read-only (metrics, costs, automatic evaluations) with conversations shown as a chat, never the span-level technical trace. Annotates traces and reviews the queues they are assigned to |

What each role can do is a set of **permissions** stored as data, not hard-coded, so other roles can be added later. See [Roles & permissions](./roles-and-permissions) for the full matrix and a simulator.

Your effective permissions in an experiment are the union of your organization role and your experiment role.

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

# As org_admin, into an experiment (role: technical or business)
curl -X POST $API/api/v1/experiments/{experimentId}/members \
  -H "Content-Type: application/json" \
  -d '{"email": "new.person@company.com", "role": "business"}'
```

## Your identity provider (Entra ID, Okta, SailPoint)

If your company manages who-can-do-what in its identity provider, MemTrace can follow it instead of you inviting people one by one. An `org_admin` configures it in **Admin → organization → Identity**. Two ways, which can be used together:

- **Group mappings.** Say that a group (name or id, exactly as your provider puts it in the sign-in token) gives a role: `technical` or `business` in one experiment, or `org_admin` for the whole organization. At each sign-in MemTrace reads the token's groups and adds or removes those roles. The token claim is `groups` by default; change it there if yours is `roles`.
- **SCIM provisioning.** Create a token, then give your provider the base URL shown on that tab (`https://<your-host>/api/scim/v2`) and the token. The provider creates and deactivates people and pushes group membership. A deactivated person loses the roles they got from groups **at once**, without waiting for their next sign-in. The SCIM `userName` must be the email the person signs in with; a person who has not signed in yet gets their roles on first sign-in.

Rules that keep this safe:

- Roles you assign by hand are never changed or removed by the provider. Members whose role comes from the provider show an **IdP** badge.
- If a sign-in token carries no groups at all (for example Google, or Entra when a person is in too many groups), nobody's access changes. A token with an *empty* list does remove the roles that came from groups.
- If two groups give different roles in the same experiment, the one with more permissions wins.
- The last `org_admin` of an organization is never removed by the provider.
- Using your own sign-in tenant per customer (own issuer and client secret) is not available yet; sign in with Google or Microsoft and map groups from the token.

## Agent API keys

Agents authenticate with an API key tied to one experiment, not with a user account. A `technical` profile creates their own keys, and an `org_admin` sees and revokes all of them, in **Admin → organization → experiment → API keys** (the **Connect** tab walks through the setup), or with `POST /api/v1/experiments/{experimentId}/api-keys`.

- Keys look like `mtk_Ab3xY9...`. The plaintext is shown **once**; only its hash is stored.
- A key works for OTLP ingestion and for the evaluation endpoints of its own experiment. It does not reach any other experiment.
- An invalid or revoked key is rejected with `401`. Revoke a key with `DELETE /api/v1/experiments/{experimentId}/api-keys/{keyId}`.
- The ingest gateway checks that the key is valid. It does not check that the `service.name` of the traces matches the key's experiment.

How the SDK sends the key is in [Authentication](/library/authentication).
