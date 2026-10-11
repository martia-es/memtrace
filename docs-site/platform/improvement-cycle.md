# The improvement cycle in 30 minutes

One walkthrough from a bad answer in production to a fix that is tested and deployed. It uses the reference agent of the repository (`weather_assistant`), but every step works the same with yours.

```
trace → failure → dataset → prompt → evaluation → deploy
```

What you need before you start:

- The [platform running](./getting-started) and an agent sending traces ([library quickstart](/library/quickstart)).
- The agent reads its prompt with [`memtrace.prompts`](/library/prompts). Without that, MemTrace cannot tie a trace to a prompt version, and steps 4 and 5 are manual.
- The `technical` role in the agent's experiment. Steps 1 to 6 need it; a `business` profile can only label (see [Annotations & review](./annotations)).

## 1. Find a bad answer (3 min)

Open **Conversations** and look for a turn that went wrong: an error badge, a very slow turn, or a 👎 from the user ([User feedback](/library/feedback)). Click it to open the trace.

You see the conversation and, under it, the tree of steps: the model calls, the tools, the guardrails. The deepest red step is the cause; the ones above it only passed the error up. Note the **prompt and version** shown on the trace (for example `weather-system v2`): that is the text that produced the answer.

Example: someone asks *"Will it rain in Sevilla tomorrow?"* and the agent answers with today's weather.

## 2. Turn it into a test case (3 min)

On the trace press **Add to dataset**. Pick a dataset (or create one), check the **Input**, which is copied from the trace, and type the **Expected output**: the answer a good agent would give. Add it.

From now on this case runs on every evaluation. Do it for three to five failures of the same kind: a single case is an anecdote, a handful is a regression test. If several people should agree on what "correct" means, send the traces through a [review queue](./annotations#review-queues) instead and add the resolved ones.

More on this step: [Datasets & offline evals](./evaluation#datasets).

## 3. Measure the starting point (5 min)

Before changing anything, run the dataset against the agent as it is now. In the dashboard open the dataset and press `</>` to generate `run_eval.py` (see [Generate the script from the platform](/library/evaluation#generate-the-script-from-the-platform)), then:

```bash
python run_eval.py
```

The run appears under **Evaluations → Runs**. Open it: the item you added should fail. This is your baseline, the run you will compare against.

## 4. Fix the prompt (5 min)

Go to **Prompts**, open the prompt of the failing trace and press **Fix a failure** (or **Fix with a prompt change** on the trace itself). MemTrace shows what failed and starts the editor from the version that trace used. Change the text and **Save as draft**.

Then press **Test it on this case**: the real agent runs with the draft and with the original version, side by side, on the same message. If the draft is better, **Publish** it. A draft gets no tag, so nothing in an environment changes yet.

More on this step: [Drafts and fixing a failure](./prompts#drafts-and-fixing-a-failure).

## 5. Evaluate the change (5 min)

Run the same dataset again, now with the agent reading the new version (the playground and the evaluation both need the agent to read its prompt through `memtrace.prompts`). Then open **Evaluations → Runs**, tick the baseline and the new run and press **Compare runs**.

Read it in this order:

1. **Per-evaluator delta.** Did the target evaluators go up?
2. **Regressed items.** A fix that repairs one case and breaks two others is not a fix.
3. **What changed in the dataset** between the two runs, so you know the difference is not the data.
4. With few items, a few points of difference can be noise. Run it more than once before you trust a small gain.

If it is worse, go back to step 4 with another draft. Nothing reached production.

More on this step: [Offline evals](./evaluation#offline-evals).

## 6. Promote the prompt (3 min)

Move the tag in this order: `dev`, `pre`, then `pro`. With a [promotion policy](./prompts#promotion-policy-evaluate-before-you-promote) on the prompt, MemTrace only lets a version reach `pre` or `pro` if an evaluation of that exact version passed, and an [approval rule](./prompts#approvals-a-second-opinion-before-a-change) can ask someone else to confirm.

Because the agent follows its tag, **a prompt change needs no deployment**: moving `pro` changes what production says within seconds. If the fix is in the prompt only, you are done here and can skip step 7.

## 7. Deploy a code change (6 min)

If the fix touched code (a tool, a guardrail, a model setting), it needs a deployment:

1. Push to your branch. Your CI runs the evaluation on that commit and uploads the run, labelled with the commit ([Set up deploys](./deploy-setup)).
2. Open the agent's card in **Assistants**. On the environment press **Deploy**. MemTrace shows the branch, the commit and whether that exact commit passed its evaluation.
3. If it passed, **Deploy** starts your workflow. MemTrace never builds or deploys anything itself; it asks GitHub Actions to run yours and shows the result.

A commit without a passing evaluation cannot be deployed, except by someone with the governance permission and a written reason. The same check can also block the pull request: [Block pull requests that fail their evaluation](./deploy-setup#block-pull-requests-that-fail-their-evaluation).

## 8. Close the loop

Wait for real traffic and compare the new version with the old one: errors, latency and cost, in the prompt's **Behaviour** tab or, for all versions at once, in [Overview › Analytics](./dashboard#analytics). Tick the two versions to see how far to trust the difference. If an [alert or budget](./alerts) fires, you will hear about it without looking.

## If a step does not work

| What you see | Usual cause |
|---|---|
| The trace shows no prompt version | The agent does not read the prompt with `memtrace.prompts`, or compiles it outside a traced step |
| **Fix a failure** lists nothing | Only traces of the last 30 days that used that prompt appear |
| **Try it** says *NOT applied* | The agent needs `MEMTRACE_ALLOW_PROMPT_OVERRIDE=true` and the override middleware, in a non-production environment |
| The new run does not appear in Compare | The run is still `running`, or it used another dataset |
| The prompt cannot reach `pro` | The promotion policy has no passing run of that exact version |
| **Deploy** is blocked | The commit has no passing evaluation, or the evaluation ran with uncommitted changes |
