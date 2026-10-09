# Prompts

The place where the prompts of your agents live, with their history. A prompt belongs to the organization and is associated with one or more agents, so you can filter by agent and share one prompt between several of them.

## The list: what is live

The top of the list is a board of what is live. For `dev`, `pre` and `pro` it shows how many of your prompts have that environment pinned, and an orange block counts the prompts whose `pro` tag is **behind the latest version**, with the total number of versions waiting to be released. Each prompt below has:

- its status: *N versions behind in PRO*, *In sync* (production runs the latest version) or *Not released* (no `pro` tag);
- the version each tag points to (`dev → v12`);
- a line with its last versions: the tags hang from the version they point to, and the stretch after `pro` is orange because those versions are not released yet.

Use the chips above the list (*Behind in PRO*, *In sync*, *Not released*) to see only the prompts that need attention. The board assumes the usual `dev`, `pre` and `pro` environments.

## Versions

Every save creates a new, **immutable version** (`v1`, `v2`, `v3`…): the text, the variables it uses, who saved it, when and a message about what changed. Versions are never edited or deleted, so you can always see exactly what ran at any moment. Saving a text identical to the latest version is rejected: there is nothing to version.

Variables are written `{{city}}`; MemTrace detects them when you save and lists them on the version.

Inside a prompt, the versions are listed on the left. **Pinned by tags** stays on top, so the versions that `dev`, `pre` and `pro` point to are always one click away; below, **all versions** grouped by month. Type a number (`12`) or a word of the message in the search box to find one. Above the tabs, a strip says what runs in each environment and, when production is behind, by how many versions.

On **Content** the text has numbered lines, the `{{variables}}` are highlighted, and the lines changed since the version it came from are marked.

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

## Traces of a version

The **Traces** tab lists the traces that used the selected version (or all versions), so you can open the conversation behind any number in Evidence. **Open in Conversations** takes the same search to the full list.

The link also works the other way. A trace, a conversation and every item of an evaluation run show the **prompt and version** that produced them (`weather-system v2`), and clicking it opens that version here. In **Conversations**, `?prompt=weather-system&pv=2` filters the list to one version, and a *Prompt* column shows it on every row.

An agent only shows up when it reads the prompt with [`memtrace.prompts`](/library/prompts) and compiles it inside a traced step. To get one conversation per chat session, wrap each turn in [`memtrace.session(...)`](/library/conversations); otherwise every turn is an isolated trace.

## Evidence: what each version did

The **Evidence** tab shows, for every version that had traffic in the last 24 hours, 7 or 30 days, what happened in the traces that used it:

| Column | Meaning |
|---|---|
| Traces | Traces where an agent used this version. A trace that used two versions counts for both |
| Errors | % of those traces where **any** step failed (an agent often answers after a tool fails) |
| Latency p95 | Duration of the whole answer; 95 % were faster than this |
| Cost / trace | Tokens × the model price. A **+** means some model has no known price, so the real cost is higher; a dash, that none has |
| User approval | % of thumbs-up from [user feedback](/library/feedback), and how many traces were rated |
| One column per evaluator | Results of your [offline evaluations](./evaluation) on traces that used the version: pass rate (yes/no), average (numeric) or number of items |
| Main failure | The most frequent cause in plain language, as in the Overview's failures |

Versions with fewer than 30 traces are marked **few traces**: their figures are only indicative. Below the table, **What failed most** adds up the main failure causes of all the versions.

In **Compare**, above the text diff, **How it behaved** puts two versions side by side in one card per metric and says what got *better*, *worse* or has *no change* (less than 5 % of movement is noise). When either version has fewer than 30 traces it warns that the differences may be chance. Use it with a similar period and traffic for both: a version that ran in a quiet week is not comparable with one that ran in a busy one.

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

## Try it: test a version in the real agent

The **Try it** tab runs your real agent —with its tools and knowledge— using the version you choose for one message. Nothing is promoted and no tag moves.

1. Choose where to run it. Only environments that are not production and need no credentials are offered; production is never used (there, you promote instead).
2. Choose a version, and optionally another one to **compare with**: both run at the same time, side by side.
3. Type the message, or paste a **trace id** to load the message of a real conversation. The original answer is shown next to the new ones.
4. **Run**. Each answer says whether it was **applied**. If it says *NOT applied*, the agent answered without using that version, so the answer is **not** from it: check that the agent reads the prompt with [`memtrace.prompts`](/library/prompts#try-a-version-in-the-real-agent), has `MEMTRACE_ALLOW_PROMPT_OVERRIDE=true` and the `PromptOverrideMiddleware`. The tab also warns beforehand when no agent has reported reading this prompt in that environment.

From a trace's page, **Try another prompt version** opens this tab with that trace loaded, so you can replay the same message with another version. It needs content capture on in the agent to know the message; otherwise type it. Each run is a new conversation with one message.

Running the agent has real effects (its tools run), so it needs `prompt:write` and read access to the agent. Tests are marked on the trace and are **not counted** as evidence of a version or toward the promotion policy.

## Drafts and fixing a failure

A **draft** is a version waiting for review. It has a number, so you can **test it in the real agent** ([Try it](#try-it-test-a-version-in-the-real-agent)) and **evaluate it** (an offline evaluation asks for it by number), but it gets **no tag**: no environment can use it. Only a person with `prompt:write` can **Publish** it (it becomes a normal version, which still has to pass the [promotion policy](#promotion-policy-evaluate-before-you-promote) to reach `pre` or `pro`) or **Discard** it. Drafts show a *draft* label in the version list and are not counted as "the latest version" or when measuring how far production is behind. A discarded draft's number is never reused, because its traces and evaluations carry it.

You can save any edit as a draft with **Save as draft** in the editor, but the main way to create one is from a failure:

1. On a **failed trace** that read its prompt from the registry, press **Fix with a prompt change** (or open the prompt's **Fix a failure** tab and paste a trace id).
2. MemTrace shows **what failed** (the deepest failing step, not the ones that only passed the error up), what the person said and what the agent answered. The editor starts from **the version that trace used**, and the reason is filled in with the failure.
3. Change the text and **Save as draft**. The draft remembers the failure: its page shows what it was for and links to the trace.
4. **Test it on this case** runs the real agent with the draft and with the version it came from, side by side, on that same message.
5. If it is better, **Publish** it; promote it as usual.

Prefer a model to write the proposal? The SDK can ask **your** LLM with **your** key and save the result here as a draft: [`prompts.propose_fix`](/library/prompts#propose-a-fix-with-your-own-model). MemTrace holds no provider keys.

## Fragments: text shared between prompts

A **fragment** is text several prompts need (tone, safety policy, output format). Create it with **+ New fragment**; it has versions, tags and history like a prompt, but it is not deployed to an agent. A prompt uses it by writing, anywhere in its text:

```text
{{> tone@pro}}     the version the tag "pro" of the fragment "tone" points to
{{> tone@3}}       version 3 of "tone"
```

The reference is **mandatory** (an include without `@tag` or `@number` is rejected). When you save, MemTrace **resolves the include and pins it to the exact version it found**. Your agent receives the final text, already joined, so nothing changes in how you read prompts and there is no extra latency. A version therefore always means the same text: editing a fragment later **never** changes a version that already exists, and its evidence and evaluations stay valid.

- A prompt shows what it wrote (**Source**) or what the agent receives (**Resolved**), and an **Includes** card with each fragment and the version it is pinned to.
- When a tag moved on, the card says *now v4* and offers **Rebuild with the current fragments**. That saves a **draft** to review, test and publish; it is never published for you. A reference by number never goes out of date.
- On a fragment, **Used by** lists the prompts that include it in their latest version and which are behind. **Rebuild N prompts as drafts** does it for all of them at once, skipping those you cannot write.

Limits: a fragment cannot include another fragment; only published versions can be included; at most 20 different fragments per version. The fragment's `{{variables}}` become variables of the prompt.

## Dependencies and impact

The **Dependencies** tab answers "what is connected to this prompt?":

- **Agents that read it**, and what each one *reports serving* in every environment (the tag it follows or the fixed version it asked for, and when it was last seen). An agent linked but not using [`memtrace.prompts`](/library/prompts) shows *has not reported reading it yet*.
- **Evaluated with**: the dataset and number of runs of its [promotion policy](#promotion-policy-evaluate-before-you-promote), or a note that it has none.
- **Fragments it includes**, pinned to which version (and *now vN* when the tag moved on); on a fragment, **the prompts that include it**.

When you promote, the confirmation shows **Who receives it** before you press the button: the agents that follow that tag with `v3 → v4`, how many use a fixed version and will not notice, and, for a fragment, which prompts include it through that tag (they keep their text and show as *behind* until rebuilt). It is information only: what can block a promotion is still the policy.

What agents report is as fresh as their last check (a few minutes); an agent that has not been seen for 7 days disappears from the list.
