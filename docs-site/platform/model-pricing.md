# Model pricing and quality

**Costs** lists every model MemTrace knows a price for, and next to each price shows how people rate the model in chat. Use it to compare what a model costs with how good it is before you switch your agent to it.

## What each column means

| Column | Where it comes from |
|---|---|
| **Input** and **Output** | Price per million tokens, synced every day from the public [LiteLLM](https://github.com/BerriAI/litellm) catalog. MemTrace uses these prices to compute the cost of every call you see in conversations and traces. A model name with a date or a provider prefix, such as `gpt-5.2-2025-12-11`, uses the price of `gpt-5.2`; variants such as `mini` or `high` are not assumed to cost the same. |
| **Quality · Arena Elo** | The Elo score of the model on the [Arena](https://arena.ai) text leaderboard (overall), synced every day. |

A quality cell shows the **Elo**, its margin (**±4** means the real score is probably within 4 points), a bar to compare it with the other models, and the **rank** on the leaderboard (**#15** is the fifteenth).

::: warning What the Elo does not tell you
It measures which answer people prefer in a chat. It does not measure whether the model gets **your** task right, how well it calls tools or how it handles long documents. Use it to shortlist models, and use an [evaluation](/platform/evaluation) on your own dataset to choose between them.
:::

## When a model has no score

Arena and LiteLLM do not always call a model the same. MemTrace shows a score without asking only when the two names are the same once the provider is ignored (`azure/gpt-5.2` and `gpt-5.2` share one score). In every other case it never guesses, because a name that differs by a suffix can be a different run of the model, and a different score:

| Arena name | Elo |
|---|---|
| `claude-sonnet-4-5-20250929` | 1439 |
| `claude-sonnet-4-5-20250929-high-32k` | 1435 |

| What you see in the cell | What it means |
|---|---|
| A score, with **via gpt-5.2** | The model is a copy of another one (another provider) and shares its score. |
| `Arena: claude-sonnet-4-5-20250929` and **Confirm match →** | Arena lists a model with a similar name. Nobody has said yet that it is the same model. |
| **Awaiting confirmation** | The same, but you cannot confirm it. Someone with the `technical` profile can. |
| **— No Arena equivalent** | Arena publishes no model with that name. |
| **— Arena doesn't list it** | Somebody on your team checked and decided that Arena does not publish this model. |
| **no longer ranked** | The model was on the leaderboard and has been removed. You see its last known score. |

## Confirm a match

Click **Confirm match →** on a row, or **Review matches** in the blue banner (it appears only when a model your agent uses is waiting). A panel opens with one card per model:

- **Your model** is the name in the price catalog.
- Under **Arena lists it as…** you see each candidate with its Elo, rank and votes. The one with the closest name is selected and marked **CLOSEST NAME**; pick another one if it is the right one.
- **Confirm match** saves the choice and the score appears in the table.
- **None of these** discards those candidates; they are not offered again.
- **Arena doesn't list it** marks the model as not published, so it stops being offered.

This only decides where the quality score comes from. It does not change how your agent runs or how its cost is computed. A decision applies to **the whole organization**, stays when the daily sync runs again, and is recorded in the [audit log](/platform/data-protection#the-audit-log). You need the `pricing:manage` permission, which the `technical` profile has.

The panel starts with the models **in use**, the ones that appear in the traces of your agent in the last 30 days. **Others** are models that have a candidate but that your agent does not call; there can be hundreds, so the panel shows 20 at a time.

## The In use and Needs review views

Under the banner, three views narrow the table. The choice goes in the address (`?show=in_use`, `?show=review`), so you can share the link:

- **All models** is the default.
- **In use** shows the models in the traces of the agent you were looking at.
- **Needs review** shows the models that wait for a match.

## The bell

When a model your agent uses is waiting for a match, the bell shows a **Models** tab with **Review matches →**. It is a pending task, not an event: it stays until somebody decides, then disappears. Only people who can decide see it. It is not sent by email, because a missing score costs nothing while it waits. Models your agents do not use never notify; they appear only under **Needs review**.

## Where the scores come from

The quality data is the public dataset `lmarena-ai/leaderboard-dataset` from [Arena](https://arena.ai), published under the [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) licence. The page names Arena and shows the date of the leaderboard.

- A daily job downloads it. If the download fails or the file looks wrong, the scores you already have stay as they were; they get older, they do not disappear.
- Before the first sync the **Quality** column is hidden and the prices work as usual.
- Only the text leaderboard (overall) is shown. Other Arena boards, such as code or vision, are not.

**Operators:** to run the sync now, use `make quality-sync`. The job is the `model-quality-sync` CronJob and needs access to `huggingface.co`.
