# Roles & permissions

Technical reference for how MemTrace decides who can do what. For the day-to-day view (inviting people, API keys) see [Organizations & roles](./access-control).

The code never asks "is this person an admin?". It asks "does this person have the `queue:curate` permission?". Each role is a set of permissions stored in the database (`roles` and `role_permissions`), so adding a profile means adding rows. The tables are in the [Data model](./data-model).

## How a request is decided

On every request MemTrace joins the permissions of the person's organization role and their experiment role. If the permission the action needs is in that union it goes ahead; otherwise the answer is `403`.

1. **Person.** Signs in with Google or Microsoft. Their account is `users`.
2. **Organization role** (`org_memberships`) **+ experiment role** (`experiment_memberships`). Today the organization role is `org_admin`; the experiment roles are `technical` and `business`. The organization role applies to every experiment of that organization; the experiment role only to that experiment.
3. **Effective permissions.** The union of the permissions of both roles (`role_permissions`).
4. **Is the needed one there?** Yes: the action goes ahead. No: `403 Missing permission`.

## The three built-in roles

| Role | Level | In one line |
|---|---|---|
| `org_admin` | Organization | Manages people, experiments and keys. **Does not read data.** |
| `technical` | Experiment | The profile that shapes review and evaluation: the whole dashboard including the technical trace, queues, rubrics, datasets and curation, plus their own API key. |
| `business` | Experiment | The people who know what the agent should answer: the whole dashboard read-only (metrics, costs, automatic evaluations), traces only as a conversation, and labels in the queues where they are a reviewer. |

## Permission matrix

Click a permission to see what it unlocks, or a role name to highlight its column.

<ClientOnly>
  <PermissionMatrix />
</ClientOnly>

## Simulator

Choose a person's organization role and experiment role to see what they can do.

<ClientOnly>
  <PermissionSimulator />
</ClientOnly>

## Roles that come from the identity provider

If a company manages who does what in Entra ID, Okta or SailPoint, MemTrace can follow it instead of inviting people one by one. There are two entry points, which can coexist; both end in the same reconciliation. An `org_admin` configures it in **Admin → organization → Identity**.

| | Token groups (at sign-in) | SCIM 2.0 (real time) |
|---|---|---|
| How | The sign-in token carries the person's groups (claim `groups` by default). `external_mappings` says which group gives which role. | The provider uses a token (`scim_tokens`) against `/api/scim/v2`, creates or deactivates people (`scim_users`) and pushes groups (`scim_groups`). |
| When it applies | At the next sign-in | At once. A deprovisioned person loses access without signing in |
| Detail | The claim name is configurable per organization | The SCIM `userName` must be the email the person signs in with |

Both leave the person's external memberships exactly as the mappings say. Each membership carries a `source`: `manual`, `oidc` or `scim`, and each source only touches its own.

Safety rules:

- **Manual wins.** A membership assigned by hand is never overwritten or removed.
- **No groups, no changes.** If the token carries no groups claim (Google, or Entra when a person is in too many groups), nothing is removed. An *empty* list does remove access.
- **Strongest wins.** If two groups give different roles in the same experiment, the one with more permissions stays.
- **Never without an administrator.** The last `org_admin` of an organization is never removed.
- **A failure does not block.** If reconciliation fails it is logged and the person can still sign in with the access they already had.
- **Only our roles.** The customer maps groups to roles, never to individual permissions. The permission catalog is internal.

::: warning Not available yet
Sign-in with a provider of your own per organization (own issuer and client secret), and reading Entra's groups through Microsoft Graph when the token omits them.
:::

## Frequently asked questions

### Why can't the `org_admin` see traces?

Separation of duties: whoever invites people and manages keys does not have to read data. Anyone who also works in an experiment needs their own role there. When you create an experiment you are added to it as `technical`.

### What exactly does a `business` profile see?

The whole dashboard read-only (metrics, costs, automatic evaluations) and traces as a conversation, never the span tree. They label in the queues where they are a reviewer, but do not create queues, do not see other reviewers' answers and do not promote anything to a dataset.

### Is hiding the technical trace from `business` a security boundary?

Only partly. The API blocks the `spans` endpoint and the conversation tree, but the conversation view is built from the trace detail, which still carries the spans. For a `business` profile, hiding the tree is an interface rule. Closing it fully needs a conversation-only endpoint.

### Who can be a reviewer of a queue?

Only members of the experiment with the `annotation:write` permission. An `org_admin` with no working role does not appear as a candidate.

### How do I add a new role?

Insert rows in `roles` and `role_permissions` and assign it. No routes need to change. If the role needs a capability that does not exist, add a new permission to the catalog, which is the only thing the code knows about.

### What about `org:manage` and `experiment:create`?

They are in the catalog and in the `org_admin` role, but today the organization routes check them by asking whether the person is an `org_admin`, which is equivalent while that is the only organization role. When there are more, they will check the permission.
