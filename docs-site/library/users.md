# Users

Wrap each request in `user(...)` and the dashboard can show what each end user costs, in **Overview › Breakdown › User**:

::: code-group

```python [Python]
import memtrace

def handle_message(user_id: str, conversation_id: str, text: str) -> str:
    with memtrace.user(user_id), memtrace.session(conversation_id):
        return run_agent(text)
```

```ts [TypeScript]
import { user, session } from "@memtrace-ai/sdk";

await user(userId, () => session(conversationId, () => runAgent(text)));
```

:::

Every span opened inside the block carries the id, including those of auto-instrumented libraries. For LangChain and LangGraph, pass `user_id` in the run `metadata` instead.

The id should be:

- **opaque**: an internal id or a hash, not an email, a name or a phone number,
- **stable** for the same person across conversations.

The id is stored as `enduser.id`, the standard OpenTelemetry attribute for the end user of an application. Without it, the **User** view of Breakdown is empty.
