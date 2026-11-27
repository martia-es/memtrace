# Mem: lessons and fixes from recurring failures

MemTrace's discovery worker finds **rules that explain recurring failures** of your agent (shown in Analytics › Patterns). `memtrace.mem` turns one of those findings into a short **lesson** or into a **prompt draft**, written by **your own LLM**: MemTrace never holds your provider key.

```python
from memtrace import mem
from memtrace.adapters.outbound.llm.anthropic_client import AnthropicJudgeClient   # pip install "memtrace-ai[eval]"

llm = AnthropicJudgeClient()
finding = mem.findings()[0]                                  # the last discovery run of this agent

lesson = mem.distill(finding, llm)                           # one reviewable instruction
print(lesson.title, "→", lesson.guidance)

draft = mem.propose_fix(finding, "weather-system", llm)      # saved as a draft of that prompt
print(f"Draft v{draft.version} saved: review it in MemTrace")
```

- `mem.findings()` returns the findings with the rule, the failure rate, the step and error where it breaks, the occurrence per prompt version and example trace ids. `since=` / `until=` (ISO dates) narrow the range.
- `mem.distill(finding, llm)` returns a `Lesson` (`title`, `guidance`, `applies_when`, `rationale`, and the example traces as evidence). An answer that is not valid JSON, empty or too long raises `LessonError`.
- `mem.propose_fix(finding, name, llm)` distills the lesson and applies it to the prompt through the same flow as [`prompts.propose_fix`](prompts#propose-a-fix-with-your-own-model): a **draft** with the example traces as its origin. A person tests it and publishes it; it still goes through the promotion policy.
- **What the model sees**: only the finding (rule, counts, decisive step, normalized error), never a trace or a user's message. The lesson is generated text and never quotes users.
- Not every finding is a prompt problem: a rate limit or an expired key is fixed outside the prompt. Review the finding before proposing a fix.

Needs `pip install "memtrace-ai[eval]"`, `MEMTRACE_API_URL` (with the experiment id) and `MEMTRACE_API_KEY`. Lessons are not stored in MemTrace yet: `distill` returns them to your code.
