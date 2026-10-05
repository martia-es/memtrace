# Annotations & review

Human labels on traces: rubrics (score configs) that define what can be scored, the **Annotate** panel where people label a trace, review queues that distribute traces to a team, and promoting a reviewed trace into a dataset.

## Score configs

A score config fixes what can be scored and how. Without one, two people who both type `tone` may mean a 1-5 scale and a `formal`/`casual` choice, and their labels can't be compared.

Each config has:

- a `name`,
- a type that matches the scores you already produce: `numeric` (with a min and max range), `boolean`, or `categorical` (at least two labels, each optionally carrying a number for ordinal scales such as `bad=0, ok=1, good=2`),
- an optional guideline for whoever annotates.

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

- Press **Open** on a row (**Resolve** when reviewers disagree) to see the conversation that was evaluated, shown as a chat, together with what each reviewer answered. For each criterion you can pick the **final value** and, optionally, type the **correct answer** (what the agent should have said). **Save decision** stores it as your decision; reviewers' labels are never changed, so the agreement figures stay honest. **Clear decision** removes it.
- Tick the rows you want and press **Add to dataset**. Only reviewed rows without an open disagreement can be ticked; **Select all ready** ticks them all. The expected output of each item is the correct answer you typed or, if you chose a categorical criterion in "Expected output from", the agreed (or resolved) label. Without either, the item has no expected output.
- A row whose trace is already in a dataset shows a link ("→ Regression v3.0") to it. The new items remember which queue they came from (`promotedFrom.queueId`).
- Items that are already in the dataset or have no saved input are skipped and counted in the notice. Each batch of 100 items is one new dataset version.

Once a judge's items have been labelled, **Judge verdict** in the **Summary** tab says in plain words whether the judge matches your reviewers: trust it, check its rubric, or do not use its score.

The API accepts several traces in one call, which creates one version for all of them. See the [Query API](/platform/api#evaluation-adr-028-adr-031-adr-032).

## Where the API is

Score configs, annotations and queues have their own endpoints. See [Query API](/platform/api#score-configs-adr-036), [Annotations](/platform/api#annotations-adr-037) and [Annotation queues](/platform/api#annotation-queues-adr-039).
