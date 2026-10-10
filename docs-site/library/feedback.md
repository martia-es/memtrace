# User feedback

Let the people who use your agent say whether an answer was good. The vote is saved on the **trace** that produced the answer, next to its latency, cost and reviewer labels.

```python
import memtrace

def answer(message: str) -> dict:
    with memtrace.trace_step_context("conversation_turn", step_type="chain"):
        reply = run_agent(message)
        trace_id = memtrace.current_trace_id()   # return it to your UI with the answer
    return {"reply": reply, "trace_id": trace_id}

# when the person votes (from your server)
memtrace.feedback(trace_id, "down", end_user_id="user-42", comment="Wrong city")
```

Needs `pip install "memtrace-ai[eval]"`, `MEMTRACE_API_URL` (with the experiment id, like [offline evaluation](./evaluation#send-them-to-memtrace-dataset-id)) and `MEMTRACE_API_KEY`. **Call it from your server**, never from the browser: the API key must not reach your users.

## Functions

| Function | What it does |
|---|---|
| `memtrace.current_trace_id()` | Trace id of the running span, to return with the answer. `None` when tracing is off |
| `memtrace.feedback(trace_id, rating, *, comment=None, span_id=None, end_user_id=None, external_message_id=None)` | Saves the vote. `rating` is `"up"` / `1` or `"down"` / `-1`. Raises `httpx.HTTPStatusError` if MemTrace rejects it |
| `memtrace.retract_feedback(trace_id, *, span_id=None, end_user_id=None)` | Withdraws the vote (idempotent) |

- **`end_user_id`**: a pseudonym you choose, never an email or a name. Voting again on the same answer replaces the vote. Without it the vote is anonymous: one per trace.
- **`span_id`**: rates one step instead of the whole answer.
- **`external_message_id`**: your own message id, kept as metadata.
- A regenerated answer is a new trace, so it gets its own vote.

## Where you see it

- **Traces and Conversations**: a **User feedback** column.
- **Trace detail**: a strip with the votes, the comments and whether users agree with your reviewers.
- **Summary**: **User satisfaction** (% of positive votes) and *Needs attention* items.
- **Assistants → Talk**: if the agent returns its trace id, MemTrace's chat shows thumbs under each answer. See [Assistants](/platform/assistants#talk-to-it).

The REST endpoint is in the [API reference](/platform/api#user-feedback-adr-062).
