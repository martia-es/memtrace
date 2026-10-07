# Annotations & review

Human labels on traces: rubrics (score configs) that define what can be scored, the **Annotate** panel where people label a trace, review queues that distribute traces to a team, and promoting a reviewed trace into a dataset.

## The whole flow in one page

From a slow or failing trace to a regression test, who does what:

| # | Who | Where | What happens |
|---|---|---|---|
| 1 | Technical | Conversations / Traces | Spot traces that are slow, fail or look wrong. |
| 2 | Technical | **Review → New queue** | Create a queue: rubric (score configs), who can annotate, reviews needed per trace. Add the traces (**Add to queue**, or a filter in **Add traces**). |
| 3 | Business (and technical, if listed) | **Review → My inbox** | Label each trace **independently** against the rubric. Nobody sees the others' answers. |
| 4 | Technical | **Review → queue → Results** | See all answers side by side. Rows where reviewers disagree are highlighted. |
| 5 | Technical | **Resolve** (a row) | Give a **Verdict** per criterion (and optionally a **Correct answer**). Reviewers' labels are never changed. |
| 6 | Technical | Bottom bar of **Results** | Tick the rows, choose a dataset and the source of the **expected output**, press **Add to dataset**. |
| 7 | Technical | SDK / **Evaluations** | Run `run_experiment` against the dataset on every change of the agent and compare runs in **Evaluations → Offline evals**. |

A row can only be ticked when it has all its reviews and no open disagreement. Business profiles label; they never see the Results tab, other reviewers' answers or the dataset.

## Score configs

A score config fixes what can be scored and how. Without one, two people who both type `tone` may mean a 1-5 scale and a `formal`/`casual` choice, and their labels can't be compared.

Each config has:

- a `name`,
- a type that matches the scores you already produce: `numeric` (with a min and max range), `boolean`, or `categorical` (at least two labels, each optionally carrying a number for ordinal scales such as `bad=0, ok=1, good=2`),
- an optional guideline for whoever annotates,
- for `boolean` configs, an optional **target pass rate** (in %). Evaluators with the same name are judged against it in **Evaluations → Trends**; without one the target is 80%.

Technical profiles manage them in **Admin → experiment → Score configs**, or with **New score config** in a trace's Annotate panel. Everyone with access to the experiment can read them.

Human labels are long-lived, so a config cannot silently reinterpret old labels:

- The type is fixed.
- A numeric range can only widen.
- Categories can only be added.
- "Deleting" archives the config. It stays readable but takes no new annotations.

To start over, archive it and create a new one. The old name is free to reuse.

Give a config the same `name` and type as one of your evaluators (say `correctness`) to line human and judge scores up. If the types differ, they are reported as not comparable instead of being mixed.

## Annotating a trace

Open any trace and press **Annotate**; in a conversation's **Table** view every turn has its own **Annotate** button, so you can label a turn without leaving the conversation. Every score config of the experiment appears with its guideline and the right control: buttons for yes/no and categories, a short numeric scale, or a number field for wide ranges. Pick a value, add an optional comment and press **Save**. You can score the whole trace or, with **Selected span**, the span highlighted in the tree, for example one wrong tool call.

The trace page also shows a **summary panel** on the right, in both the Conversation and the Technical trace views: the **Human labels** (value, who gave it, span and comment, or "Not annotated yet"), the automatic **Evaluations** (code or LLM judge scores, with their source; only shown for traces that were evaluated in a dataset run) and the **Review queues** that contain the trace with the status of its item.

- Your label is yours. Saving again edits it, and **Retract** removes it.
- Other people's labels are listed with their author. Several people can label the same trace and config.
- Technical profiles can retract anyone's label (moderation).
- **Automatic scores** from evaluation runs that reference the trace are shown below the human labels, tagged with their source (`code` or `llm_judge`). Machine and human judgments appear in one place.
- If the trace belongs to a review queue, the panel lists the queues it is in and the state of its item there ("Weekly QA · completed").
- Labels are kept even if trace retention removes the trace. Archiving a config never hides the labels already made with it.

## Review queues

Annotating one trace at a time doesn't scale into a review process. A **review queue** is a batch of traces for your team to work through with a rubric, so nothing is reviewed twice or forgotten. Open **Review** in the sidebar.

1. **Create a queue** (technical profiles): a name, optional instructions for reviewers, **who can annotate**, the score configs to use as the rubric (each one required or optional), and how many independent reviews each trace needs (1–10, never more than the people you picked). Only the people you pick can pull and label traces from that queue, so you can keep it to business profiles; being a member of the experiment is not enough, and admins who are not on the list cannot annotate either. Pick people who already have access to the experiment: its members and the organization's admins (so an org admin can assign themselves). In **Details** you can change the list later; removing someone keeps what they already labelled.
2. **Add traces** (technical profiles): **Add traces** adds the traces that match a filter *right now*: time window, status, failed spans, minimum duration, up to 500. The queue keeps their ids; it does not follow new traffic. Tick **Pick them at random** to draw the traces at random from all matches (up to the 5,000 most recent) instead of taking the first ones. From any trace, **Add to queue** adds that one trace.
3. **Review**: **Review** shows the conversation as readable turns, with the agent's reply highlighted as "Reply to review" and the rubric next to it. Tool calls appear as one line ("Used Get weather (location: Almeria)"), their data is collapsed under "Data retrieved", and system prompts are hidden. If the trace has no final reply, the page says so. Write scale anchors (what a 1 and a 5 mean) in the score config's description; they are shown under the criterion. **Show technical trace** opens the spans and their content for debugging. Keys 1–9 pick an answer for the first open criterion, and Enter submits. **Add note** adds an optional note to a criterion. **Submit & next** saves your labels and brings the next one. **Skip** hands the trace back to the others; you will see it again only once you have gone through every trace you have not seen yet. Nobody gets a trace you already labelled twice, and with several reviewers per trace each one labels it independently. Refreshing the page returns the trace you had open.
4. **Follow progress**: each queue in the table shows a notice with how many items still need review ("3 of 5 pending", or "All caught up" when none are left). Each row also shows the profile photos of the people who can annotate that queue (their initials if they have none); hover over one to see the name. Queues with pending items are listed first and marked, so you can see where to focus. **Review** only appears on queues where you are one of the people who can annotate, and only those count in the pending badge of the sidebar. Admins also get a banner, **Ready for you**, when reviewers have finished items that are not yet in any dataset; the queue row shows how many, and **Open results** / **Review results** jumps straight to the Results tab. **Details** opens the queue. Admins get three tabs: **Summary** (completed and pending counts, what each reviewer has done, how much they agree), **Results** (what every reviewer answered, see below) and **Settings** (reviews per item, who can annotate, the rubric and every item).

Things to know:

- Your labels are ordinary annotations, so they appear in the trace's Annotate panel with your name.
- A trace you started but never submitted goes back to the pool after 15 minutes, so a closed tab never blocks the queue.
- If a trace is gone by the time you open it (retention), press **Skip**. An admin can mark it **unreviewable** in Details so it stops being handed out.
- Changing "reviews required per item" on a running queue reopens items that no longer have enough reviews, and completes the ones that now do.
- A rubric can grow once the queue has items, but a score config can't be removed from it.
- Technical profiles can archive a queue. Archived queues stay readable but no longer hand out items.

The queue's **Details** also show how much its reviewers agree with each other (mean kappa, or Spearman for numbers). That is the ceiling for any judge: low agreement between people usually means the rubric is ambiguous.

Queues built from a run's items also show the judge-versus-human card. See [Agreement with human labels](/platform/evaluation#agreement-with-human-labels).

## Promoting a trace to a dataset

Found a trace where the agent got it wrong? Open it and press **Add to dataset**. Pick a dataset, check the **Input** (copied from the trace), type the **Expected output** (the correct answer), and add it. From then on the case runs with every experiment against that dataset.

- The item is a **copy**. It keeps working if retention later deletes the trace. Remove personal data from the input in the form before adding, because the item is long-lived.
- What the agent answered is stored in the item's metadata (`promotedFrom.observedOutput`), never as the expected output. A thumbs-down says what is wrong, not what is right, so you type the right answer. Without one, only evaluators that need no reference (such as LLM-as-judge) can score the item.
- Each add creates **one new major version** of the dataset. Adding the same trace twice is refused (`already_promoted`).
- The trace needs saved content (`MEMTRACE_CAPTURE_CONTENT=true` on the agent). Otherwise the input is empty and you have to type it.
- Editing the item's metadata later never removes `promotedFrom`, so the diff view still shows where each item came from.

To promote many at once, open a queue (**Review → Details → Results**). Only technical profiles see this tab, so business profiles, who label, never get to see other reviewers' answers or promote anything.

**Results** has one row per item and one column per criterion of the rubric. Each cell lists what every reviewer answered (hover a name to read their comment; people who were later removed from the queue are greyed out). Where reviewers disagree, the cell is highlighted. **Only disagreements** filters to those rows.

### Step 5: Resolve a row

Press **Open** on a row (**Resolve** when reviewers disagree). A full-size window shows the conversation that was evaluated, as a chat, next to what each reviewer answered per criterion. For each criterion you can set two different things:

| Field | What it is | Required | Used for |
|---|---|---|---|
| **Verdict** | Your final label for the criterion, for example "Concise: No" or "Tone: 3". | Yes, to settle a disagreement | Unlocks the row so it can be ticked. With "the label of…" below it becomes the expected output. |
| **Correct answer** | The text the agent should have said. | No | Becomes the dataset item's **expected output**, whatever you choose in the bottom bar. |

**Save decision** stores them; **Clear decision** removes them. Reviewers' labels are never changed, so the agreement figures (kappa, Judge verdict) stay honest, and the record of who said what is kept. Rows where everyone agrees need no decision.

### Step 6: Add to dataset

Tick the rows you want (**Select all ready** ticks every row that can be added) and fill the bar at the bottom. The button stays disabled, with a line telling you why, until at least one row is ticked and a dataset is chosen.

1. **Choose a dataset…**: where the items go. Create it first in **Evaluations → Datasets** if you have none.
2. **Expected output**: what each new item will treat as the right answer. A reviewer's label is a verdict ("Yes", "5"), not a sentence, so you decide where the answer comes from. **A Correct answer you typed in Resolve always wins on its row**; the option only decides the rows without one.

| Option in the list | Rows without a typed Correct answer get… | Use it when |
|---|---|---|
| **Expected output: only the correct answer I typed** (default) | No expected output. Only evaluators that need no reference (such as LLM-as-judge) can score them. | You judge by criteria (tone, conciseness) and have no single right answer. |
| **Expected output: the reply that was reviewed (unless I typed one)** | The agent's reply that reviewers judged, copied as it was. | The reviewed replies are good and you want them as the reference. Type a Correct answer on the ones that are not. |
| **Expected output: the label of "&lt;criterion&gt;" (unless I typed one)** (one entry per categorical criterion) | The agreed or resolved label of that criterion, for example `Yes`. | The criterion is itself the answer, such as a classification. Numeric and boolean criteria are not offered: a score is not a reference answer. |

3. **Add to dataset**: creates the items. You get a notice with how many were added and why any were skipped.

What to expect afterwards:

- Items are **copies**, so they survive trace retention. Each batch of 100 items is **one new dataset version**.
- Each row then shows a link to the dataset it went into ("→ Regression v3.0"). The item remembers its queue (`promotedFrom.queueId`) and the agent's original reply (`promotedFrom.observedOutput`), even when the reply was not used as expected output.
- Skipped, with the reason in the notice: traces already in the dataset, and traces with no saved input (`MEMTRACE_CAPTURE_CONTENT=true` on the agent saves it).

### Step 7: Use the dataset

Open it in **Evaluations → Datasets** to check or edit the items. Run `run_experiment` against it from your code or CI (you can pin a version with `dataset_version="2.1"`); results appear in **Evaluations → Offline evals**. See [Evaluation](/library/evaluation).

- A row whose trace is already in a dataset shows a link ("→ Regression v3.0") to it. The new items remember which queue they came from (`promotedFrom.queueId`).

Once a judge's items have been labelled, **Judge verdict** in the **Summary** tab says in plain words whether the judge matches your reviewers: trust it, check its rubric, or do not use its score.

The API accepts several traces in one call, which creates one version for all of them. See the [Query API](/platform/api#evaluation-adr-028-adr-031-adr-032).

## Where the API is

Score configs, annotations and queues have their own endpoints. See [Query API](/platform/api#score-configs-adr-036), [Annotations](/platform/api#annotations-adr-037) and [Annotation queues](/platform/api#annotation-queues-adr-039).
