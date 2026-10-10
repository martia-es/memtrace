# User feedback (👍/👎)

Let the people who use your agent say whether an answer was good. The vote is saved on the **trace** that produced that answer, so you see it next to latency, cost and the reviewers' labels.

```python
import memtrace

def answer(message: str) -> dict:
    with memtrace.trace_step_context("conversation_turn", step_type="chain"):
        reply = run_agent(message)
        trace_id = memtrace.current_trace_id()   # hand it to your UI with the answer
    return {"reply": reply, "trace_id": trace_id}

# later, when the person clicks 👍 or 👎 (from your server)
memtrace.feedback(trace_id, "down", end_user_id="user-42", comment="Wrong city")
```

Needs `pip install "memtrace-ai[eval]"`, `MEMTRACE_API_URL` (with the experiment id, like [offline evaluation](./evaluation#send-them-to-memtrace-dataset-id)) and `MEMTRACE_API_KEY`. **Call it from your server**, never from the browser: the API key must not reach your users.

## Functions

| Function | What it does |
|---|---|
| `memtrace.current_trace_id()` | Trace id of the span being run, to return to your UI together with the answer. `None` when tracing is off |
| `memtrace.feedback(trace_id, rating, *, comment=None, span_id=None, end_user_id=None, external_message_id=None)` | Saves the vote. `rating` is `"up"` / `1` or `"down"` / `-1`. Raises `httpx.HTTPStatusError` if MemTrace rejects it (unknown trace, invalid rating) |
| `memtrace.retract_feedback(trace_id, *, span_id=None, end_user_id=None)` | Withdraws the vote (idempotent) |

- **`end_user_id`** is a pseudonym you choose (never an email or a name). The same person voting again on the same answer **replaces** their vote. Without it the vote is anonymous: one per trace.
- **`span_id`** rates one step instead of the whole answer.
- **`external_message_id`** is your own message id, kept as metadata. The key is always the trace.
- A regenerated answer is a new trace, so it gets its own vote.

## Where you see it

- **Traces and Conversations lists**: a **User feedback** column (👍 / 👎 counts).
- **Trace detail**: a colored strip with the votes, the comments and whether the users agree with your reviewers.
- **Summary**: a **User satisfaction** figure (% of 👍), and *Needs attention* items for 👎 and for answers where users and reviewers disagree.
- **Assistants → Talk**: if the agent returns its trace id, MemTrace's own chat shows 👍/👎 under each answer. See [Assistants](/platform/assistants#talk-to-it).

The REST endpoint behind this is documented in the [API reference](/platform/api#user-feedback-adr-062).
