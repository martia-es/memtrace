# Mem: lessons and fixes from recurring failures

MemTrace's discovery worker finds **rules that explain recurring failures** of your agent (shown in Analytics › Patterns). `memtrace.mem` turns one of those findings into a short **lesson** or into a **prompt draft**, written by **your own LLM**: MemTrace never holds your provider key.

```python
from memtrace import mem
from memtrace.adapters.outbound.llm.anthropic_client import AnthropicJudgeClient   # pip install "memtrace-ai[eval]"

llm = AnthropicJudgeClient()
finding = mem.findings()[0]                                  # the last discovery run of this agent

lesson = mem.distill(finding, llm)                           # one reviewable instruction
print(lesson.title, "→", lesson.guidance)

saved = mem.save(lesson)                                     # proposed in MemTrace, waiting for a person
print(saved.lesson_id, saved.status)                         # "proposed"

draft = mem.propose_fix(finding, "weather-system", llm)      # saved as a draft of that prompt
print(f"Draft v{draft.version} saved: review it in MemTrace")
```

- `mem.findings()` returns the findings with the rule, the failure rate, the step and error where it breaks, the occurrence per prompt version and example trace ids. `since=` / `until=` (ISO dates) narrow the range.
- `mem.distill(finding, llm)` returns a `Lesson` (`title`, `guidance`, `situation`, `failure`, `rationale`, the `match` and the example traces as evidence). An answer that is not valid JSON, empty or too long raises `LessonError`.
- `mem.save(lesson)` proposes it in MemTrace (state `proposed`) with the finding's metrics and example traces. A person reviews it and a technical person approves it; **nothing reaches the agent yet**. `match` says when the lesson applies (`{"tools": [...]}`, also `errorCategories` and `intents`) and by default is the tool where the finding breaks, taken from the finding and not from the model. If the finding has no tool (a silent failure or a model error), pass it: `mem.save(lesson, match={"intents": ["booking"]})`. There is one lesson per finding: saving it again raises `MemSourceError`, also after someone dismissed it.
- `mem.propose_fix(finding, name, llm)` distills the lesson and applies it to the prompt through the same flow as [`prompts.propose_fix`](prompts#propose-a-fix-with-your-own-model): a **draft** with the example traces as its origin. A person tests it and publishes it; it still goes through the promotion policy.
- **What the model sees**: only the finding (rule, counts, decisive step, normalized error), never a trace or a user's message. The lesson is generated text and never quotes users.
- Not every finding is a prompt problem: a rate limit or an expired key is fixed outside the prompt. Review the finding before proposing a fix.

Needs `pip install "memtrace-ai[eval]"`, `MEMTRACE_API_URL` (with the experiment id) and `MEMTRACE_API_KEY`. The lessons are managed through the [Mem lessons endpoints](../platform/api#mem-lessons-adr-104) (review, approve, edit as a new version).
