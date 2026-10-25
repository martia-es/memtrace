# Agent security

Two complementary tools to know how safe your agent is, and to keep it safe once it is running:

- **Red team runs** (`memtrace.redteam`): before you deploy, throw attacks at the agent and measure how many succeed.
- **Runtime detectors** (`memtrace.security`): inside the agent, check what comes out of it and which tools it is about to call. You decide in code whether to continue.

Both run in your own process. MemTrace never calls your agent and never reads your traces to classify them: it only stores and charts what your agent reports. The results appear in the dashboard under [Security](/platform/agent-security).

## Install

```bash
pip install "memtrace-ai[security]"     # detectors: secrets and personal data
pip install "memtrace-ai[eval]"         # only for the LLM judge and for uploading runs
```

## Red team your agent

```python
from memtrace import redteam
from memtrace.adapters.outbound.llm.anthropic_client import AnthropicJudgeClient

def my_agent(*, item):
    return call_my_agent(item.input)        # text, or {"text": ..., "tool_calls": [...]}

result = redteam.run_redteam(task=my_agent, name="v2", judge_client=AnthropicJudgeClient())
print(redteam.attack_success_rate(result))  # per category: items, attacks_succeeded, asr
```

It is an ordinary [offline evaluation](/library/evaluation) run named `redteam/v2`, so comparison, repeats and the evaluation gate work as usual. With `MEMTRACE_API_URL` set the seed attacks are published as a dataset and the run is uploaded; pass `dataset_id=` to reuse that dataset, or `upload=False` to keep everything local.

The seed set covers eight categories (OWASP Top 10 for LLM Applications): `prompt_injection`, `indirect_injection`, `jailbreak`, `system_prompt_leak`, `secret_leak`, `pii_leak`, `unauthorized_tool` and `harmful_content`. It is a starting point: add your own attacks with `extra_items=[{"input": "...", "metadata": {"category": "jailbreak"}}]`, because your agent has its own rules to break.

**How to read the scores.** Every boolean score is `True` when the agent **resisted**. An attack **succeeds** when any of its scores is `False`; the share of attacks that succeed is the **attack success rate (ASR)**. Lower is better.

| Score | How it is decided |
|---|---|
| `attack_resisted` | An LLM judge (needs `judge_client`) with a rubric per category |
| `no_secret_leak`, `no_pii_leak` | The deterministic detectors below, applied to the reply |
| `no_unauthorized_tool` | Your `ToolPolicy` applied to the `tool_calls` the task returned (pass `tool_policy=`) |
| `attack_category` | Not a verdict: it records each item's category so the dashboard can group the run |

## Runtime detectors

```python
from memtrace import security

verdict = security.secret_leak(reply)
if verdict.error:
    reply = "I can't share that."
```

| Detector | What it finds | Backed by |
|---|---|---|
| `secret_leak(text)` | API keys, tokens, private keys (severity `error`) | [detect-secrets](https://github.com/Yelp/detect-secrets), format plugins only |
| `pii_leak(text)` | Card numbers, IBANs, emails, Spanish NIF, US SSN (severity `warn`) | [Presidio](https://microsoft.github.io/presidio/) recognizers, no language model needed |
| `system_prompt_leak(output, system_prompt)` | Copies and light edits of your system prompt, or its canary | Word 3-gram overlap (threshold 0.3) |

For a stronger signal on the system prompt, put a random marker in it with `security.new_canary()` and pass `canary=` to the check: if the marker shows up in a reply, the prompt leaked, with no false positives.

Each call returns a `Verdict` (`ok`, `warn`, `error`, `category`, `severity`, `action`, `score`). When it detects something and `init_tracer()` ran, it also records a `security.<detector>` span with the category, severity, action and score. **The text that matched is never recorded.** Detectors cost well under a millisecond per call and make no network request.

### Control the tools your agent can use

```python
policy = security.ToolPolicy(
    allowed_tools={"search_docs", "read_file", "http_get"},
    rules={
        "read_file": {"path": security.under("/srv/data")},
        "http_get": {"url": security.domain_in({"api.example.com"}, severity="warn")},
    },
    mode="enforce",
)

@policy.guard
def read_file(path): ...                      # raises ToolPolicyViolation if an `error` rule is broken

verdict = policy.check("read_file", {"path": "/etc/passwd"})   # or decide yourself; never raises
```

- `mode="observe"` (default) only records, so you can adopt it safely and look at the dashboard first. `"warn"` also logs. `"enforce"` marks `error` violations as `blocked`, and `guard` then raises `ToolPolicyViolation`.
- A rule has a severity: `error` stops the call in `enforce`; `warn` is recorded and logged but the call continues.
- Rules available: `under(root)` (a path that stays inside `root`, `..` resolved), `domain_in(domains)` (a host or its subdomains), `one_of(values)` and `forbids(regex)`.
- Without `allowed_tools`, any tool is allowed and only the `rules` are checked.

## What this does not do

- **Prompt injection has no production detector.** No maintained deterministic tool is reliable enough, and we do not ship hand-written rules that would give a false sense of safety. Injection is **measured** by the red team run, not detected live.
- A **paraphrased or translated** system prompt is not caught by `system_prompt_leak`; only the red team judge measures that.
- A zero in the Security page means "nothing was reported", not "no attacks happened". Detectors only exist where you add them.
