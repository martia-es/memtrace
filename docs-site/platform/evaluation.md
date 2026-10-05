# Datasets & offline evals

The platform stores the datasets you evaluate against, the runs your experiments upload, and the views that compare them. The SDK side (writing evaluators, running `run_experiment`) is in [Offline evaluation](/library/evaluation).

## Datasets

Create a dataset and edit its items in **Datasets → New dataset → Items**. The Items tab works like a spreadsheet: Enter moves down, Shift+Enter adds a line break, and you can paste rows copied from Excel or Sheets. The blank last row adds an item.

Nothing is saved until you press **Publish**. Everything changed in that session becomes **one** new version, with an automatic summary such as "Added 3 · Edited 2 · Removed 1". There is no manual "create version" step.

Versioning:

- Adding or removing items bumps the **major** number. Editing content only bumps the **minor** number.
- Every item records who added it or last changed it, and when.
- The **Versions** tab is a read-only history: one row per version, with how many items were added (`+`), modified (`~`) or removed (`−`) against the previous one.
- Click ⓘ on a row to see who changed what, with a side-by-side diff. Use **Compare with** to diff against any earlier version.

SDK runs read the latest version unless they pin one with `dataset_version`. See [Dataset versions](/library/evaluation#dataset-versions).

## Runs

Every run uploaded by the SDK appears under **Evaluations → Runs**, and under its dataset's Runs tab in **Datasets**. A run has a status:

- `running`: items are still arriving. Runs in this state are left out of the offline evals views, so a partial upload never looks like a regression.
- `completed`: all items were received.

Each run records the exact dataset version it read.

## Offline evals

**Overview → Offline evals** has three views over completed runs. To open **Compare runs** with two runs already chosen, tick them in **Evaluations → Runs** and choose **Compare runs**.

- **Overview**: a health verdict at the top (Healthy at 80% or above on every pass/fail evaluator, Needs attention between 50% and 80% or when one regresses, Failing below 50%), then one card per evaluator with its latest value, a bar against the 80% target, items passed out of items scored, change against the previous run, a sparkline, and a status (Improving, Regressing, Stable, Judge changed or Baseline). Below are a passed-vs-failed chart for the latest run, the pass-rate and average charts across runs (they appear from the second run on), and the run list. Filter by dataset and time range. Click a chart point or a run to open it.
- **Run detail**: one run, with its metrics, latency (p50 / p95 / max), and the items that errored or failed a boolean evaluator.
- **Compare runs**: pick a baseline (A) and a candidate (B). You get per-evaluator deltas, and which items regressed or improved. Items are matched by identical input. It also shows **what changed in the dataset** between their versions: added, modified and removed items, and which regressions touch a changed item. If both runs used the same dataset version, it says so, because the difference does not come from the data.

Latency, tokens and cost come from the trace of each item, not from the run itself. A figure is absent when the item has no trace, or when the trace has expired.

### Judge changes

Each judge score stores the judge's model and prompt fingerprint (see [Which judge produced a score](/library/evaluation#which-judge-produced-a-score)). When an evaluator's judge differs from the previous run's:

- The affected points in the Trend chart become red diamonds, marking that the points are not directly comparable.
- An alert lists the change.
- The evaluator card shows "Judge changed" instead of an improvement or regression, because that difference measures the judge, not your agent.

Scores uploaded before judge identity was recorded have no judge information.

### Agreement with human labels

An LLM judge that says "92 % pass" is only useful if people would agree with it. Open a run and the **Agreement with human labels** card compares each judge evaluator with the human labels of the same items.

1. **Name your human rubric like your evaluator.** Create a [score config](/platform/annotations#score-configs) with the same name and type as the evaluator (for example `correctness`, boolean). Names are matched exactly. The card lists names that exist on only one side, so you can see why something is missing.
2. **Send a random sample to a review queue.** **Send items to a review queue** on the run page asks for a random sample of N items (50 by default). You can also send all of them if the run has 500 or fewer. The sample is drawn on the server, and its seed is shown in the confirmation so it can be reproduced. See [Review queues](/platform/annotations#review-queues).
3. **Read the card.** For each evaluator:
   - **Cohen's kappa** for yes/no and categorical scores: agreement beyond what chance would give. About 0.6 or more is solid; below 0.4 means the judge is not tracking human opinion. It is shown next to the plain **exact agreement**, because the plain number misleads on skewed data. If 95 % of items pass, a judge that always says "pass" agrees 95 % of the time and has a kappa of 0.
   - A **confusion matrix** (rows: human, columns: judge).
   - For numeric scores: mean absolute error, Spearman ρ, Pearson r and the share within ±1.
   - **Where they differ**: the items where judge and human disagree, each linked to its row. This is the most useful part: read those items and fix the judge's prompt.

Keep in mind:

- **Sample size.** With fewer than 20 compared items the card still shows numbers, but warns that they are noise.
- **Sampling.** If reviewers only label the items the judge failed, agreement says nothing about the rest. That is why a random sample is the default. A queue's card states how its items were chosen, and warns when the sample is not purely random.
- **Several reviewers on one item.** For yes/no and categories the majority label is used, and items with a tie are left out and counted. For numbers, the average is used.
- **Kappa "–"** means it is undefined: judge and humans gave a single label to every item.
- **Mixed judges.** If one run's scores for an evaluator come from different judge versions, no number is shown for it, since it would average two different instruments.

The API for these views is in the [Query API](/platform/api#agreement-adr-040).

## Retention

- Traces are kept for 30 days. Latency, tokens and cost for an item disappear with its trace.
- The **text** of each run item (input, output, expected output, error) is dropped after 180 days. Older runs keep their scores, trends and summaries, but their items appear without text.
