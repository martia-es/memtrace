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

## Evidence: what each version did

The **Evidence** tab shows, for every version that had traffic in the last 24 hours, 7 or 30 days, what happened in the traces that used it:

| Column | Meaning |
|---|---|
| Traces | Traces where an agent used this version. A trace that used two versions counts for both |
| Errors | % of those traces where **any** step failed (an agent often answers after a tool fails) |
| Latency p95 | Duration of the whole answer; 95 % were faster than this |
| Cost / trace | Tokens × the model price. A **+** means some model has no known price, so the real cost is higher; a dash, that none has |
| User 👍 | % of thumbs-up from [user feedback](/library/feedback), and how many traces were rated |
| One column per evaluator | Results of your [offline evaluations](./evaluation) on traces that used the version: pass rate (yes/no), average (numeric) or number of items |
| Main failure | The most frequent cause in plain language, as in the Overview's failures |

Versions with fewer than 30 traces are marked **few traces**: their figures are only indicative.

In **Compare**, above the text diff, **How it behaved** puts two versions side by side and says what got *better*, *worse* or has *no change* (less than 5 % of movement is noise). When either version has fewer than 30 traces it warns that the differences may be chance. Use it with a similar period and traffic for both: a version that ran in a quiet week is not comparable with one that ran in a busy one.

To see evaluator results per version, run `run_experiment` in the same process as the agent, reading the prompt with `memtrace.prompts`, so each item's trace carries the version it used. Seeing the evidence needs permission to read the agent's data (`prompt:read` and read access to the experiment).

## Promotion policy: evaluate before you promote

Moving `pro` changes what production says within seconds. A **promotion policy** makes that move depend on evidence: a version can reach a protected environment only if an offline evaluation of **that exact version** passes. It is optional, per prompt: without a policy, everything works as before.

Open **Tags & history → Promotion policy**, press **Add policy** and choose:

- **Evaluate against**: a dataset of the agent.
- **Passing runs in a row**: 1 to 10 (1 by default). With a non-deterministic model one pass is an indication, not proof; raise it for prompts that matter.

With a policy:

- **Protected environments** are all of them except the first (`dev` by default, where you iterate). They show a *protected* label. Free tags and removing a tag are never checked.
- When you pick a version for a protected environment and press **Move**, MemTrace first shows the verdict: *Evaluation passed*, *Not evaluated*, *Evaluation running*, *Evaluation failed* (with the evaluators below their target) or *More evaluations needed*. Only *passed* lets you promote.
- **A run counts for a version** when every item of the run that has a trace used that version. Runs that mix versions, or that used another dataset, are ignored. So run the evaluation with the agent reading the prompt through [`memtrace.prompts`](/library/prompts).
- A run passes when each yes/no evaluator reaches its target pass rate (80 % unless its [rubric](./annotations#score-configs) says otherwise) and scored all the items. The newest runs count: a later failure blocks, a later pass unblocks.
- **Going back is instant.** Pointing a tag back to a version it already had is a rollback and needs no new evaluation, unless that version only got there by skipping the evaluation.
- **Emergencies.** Someone with the governance permission can tick **Promote anyway**, write why (5 to 500 characters) and move the tag. The history keeps *skipped the evaluation: "reason"*.
- If the policy's dataset is deleted, promotions are **blocked** until you choose another one: the gate never opens by itself.

Changing or removing the policy needs `prompt:promote`, and the history shows who moved what and which verdict they got.

::: info Coming next
Replaying a real conversation with another version, and proposing a fix from a failed trace.
:::
