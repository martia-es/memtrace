# Conversations

Wrap each turn of a chat in `session(...)` and the dashboard groups the traces into one conversation:

```python
import memtrace

def handle_message(conversation_id: str, text: str) -> str:
    with memtrace.session(conversation_id):
        return run_agent(text)
```

The id must be:

- **stable** across turns of the same conversation,
- **unique** per conversation,
- **free of personal data**, because it appears in dashboard URLs.

For LangChain, pass `thread_id`, `session_id` or `conversation_id` in the run `metadata` instead. Without an id, each turn is an isolated trace.

The id is stored as `gen_ai.conversation.id`.
