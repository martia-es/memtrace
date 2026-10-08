# Prompts

The place where the prompts of your agents live, with their history. A prompt belongs to the organization and is associated with one or more agents, so you can filter by agent and share one prompt between several of them.

## Versions

Every save creates a new, **immutable version** (`v1`, `v2`, `v3`…): the text, the variables it uses, who saved it, when and a message about what changed. Versions are never edited or deleted, so you can always see exactly what ran at any moment. Saving a text identical to the latest version is rejected: there is nothing to version.

Variables are written `{{city}}`; MemTrace detects them when you save and lists them on the version.

To change a prompt, open a version and press **Edit as new version**. The new version remembers the one it started from, which is what **Compare** uses by default.

**Compare** shows two versions side by side, line by line: red is what was removed, green what was added. You can compare the selected version with any other.

## Tags: which version runs where

A tag is a label that points to one version. The tags `dev`, `pre` and `pro` (the environments of your organization) say which version each environment uses; you can also create free tags such as `stable` or `candidate`.

- Moving a **free tag** needs `prompt:write`.
- Moving an **environment tag** (`dev`, `pre`, `pro`) needs `prompt:promote`, which the `technical` role has by default.
- Each move is saved in the **history** of the prompt: from which version to which, who did it, when and the reason you wrote.
- A version can be retrieved by number (`3`) or by tag (`pro`), also through the [API](./api#prompts).

## Archive instead of delete

**Archive** hides a prompt from the list (show it again with *Show archived*) and blocks new versions and tag moves. Nothing is lost: **Restore** brings it back with its whole history. A prompt name cannot be reused inside an organization, even if the old one is archived.

## Who can do what

| Permission | What it gives |
|---|---|
| `prompt:read` | See prompts, versions, compare them and read the tag history. Every role has it |
| `prompt:write` | Create prompts, save versions, move free tags, archive and restore |
| `prompt:promote` | Move the environment tags (`dev`, `pre`, `pro`) |

Permissions apply to the organization role or to the role in any agent the prompt belongs to. See [Roles & permissions](./roles-and-permissions).

## Use them from your agent

The [Python SDK](/library/prompts) reads the prompt of an environment with `memtrace.prompts.get("weather-system")` and keeps following its tag: you move `pro` here and the agent switches within seconds, without a redeploy. Each use is written on the trace, so you can filter the traces (and spans) of a version.

## What really runs

The **Tags & history** tab starts with **In use right now**: for each environment, the version each agent reports to be using. *Up to date* means it runs the version its tag points to; *Catching up* means the tag moved and the agent has not picked it up yet (it takes up to 30 seconds, or longer if some replica is stale); *Fixed version* is an agent that asked for a version number instead of a tag; *Not reporting* means it has not reported for 15 minutes. In the version list, a version running somewhere says **Running in pro**. Agents report only when they read their prompt with the SDK.

::: info Coming next
The quality, cost and error figures of each version, and a promotion that requires a passing evaluation, are the following steps of this feature.
:::
