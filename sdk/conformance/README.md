# SDK conformance scenarios

Language-neutral scenarios that every MemTrace SDK must pass ([ADR-095](../../docs/adrs/sdk/adr-095-multi-language-sdk-contract.md)).
Python is the reference: `sdk/python/tests/test_conformance.py` runs them, and `sdk/typescript/tests/conformance.test.ts` runs the same files for the TypeScript SDK (all of them).
A scenario fails when an attribute name, a status or an HTTP request differs, so a divergence is caught in CI and not as a
missing column in the dashboard.

Change a scenario only when the contract changes (update the ADR in the same change).

## `tracing/*.json`

```jsonc
{
  "description": "what the scenario pins down",
  "env": { "MEMTRACE_CAPTURE_CONTENT": "true" },   // set before init; every other MEMTRACE_* variable is cleared
  "init": { "serviceName": "conf-agent" },          // the span exporter is an in-memory one
  "actions": [                                      // executed in order
    { "op": "session", "id": "conv-42", "actions": [ ... ] },
    { "op": "user", "id": "user-7", "actions": [ ... ] },   // enduser.id on every span inside
    { "op": "step", "name": "turn", "type": "chain", "actions": [ ... ], "fail": "message" },
    { "op": "llm", "provider": "anthropic", "model": "claude-x", "inputTokens": 7, "outputTokens": 3,
      "responseModel": "...", "finishReasons": ["end_turn"], "temperature": 0.2,
      "inputMessages": [ ... ], "outputMessages": [ ... ] }
  ],
  "expect": {
    "resource": { "service.name": "conf-agent" },   // resource attributes
    "spans": [{
      "name": "turn", "parent": null,               // parent span name, null for a root
      "attributes": { "memtrace.step_type": "chain" },   // exact values
      "attributesJson": { "gen_ai.input.messages": [ ... ] },  // attribute holds JSON text; compared parsed
      "absent": ["gen_ai.conversation.id"],
      "status": "ok"                                // ok | error
    }]
  }
}
```

- `step` opens a span named `name` with `memtrace.step_type = type`; its `actions` run inside it. `llm` records the GenAI
  attributes on the current span. `fail` makes the step raise after its actions, and the error propagates to the top of
  the scenario (the runner expects it).
- Only spans made by MemTrace's own tracer are compared; spans from auto-instrumentors are ignored.

## `http/*.json`

```jsonc
{
  "description": "...",
  "env": { ... },
  "baseUrl": "http://memtrace.test/api/v1/experiments/e1", "apiKey": "mtk_x",
  "call": { "op": "feedback" | "retractFeedback" | "promptResolve" | "evalRun", ... },
  "respond": { "status": 201, "json": { ... }, "headers": { ... } },   // canned answer of the mocked transport
  "expect": {
    "requests": [{ "method": "POST", "path": "...", "query": { ... }, "headers": { ... }, "absentHeaders": [ ... ], "json": { ... } }],
    "result": { ... }     // optional: what the call returns (promptResolve)
  }
}
```

`evalRun` takes an optional `repeat` (`groupId`, `index`, `total`): the execution of a run launched with `repeats=total`
(ADR-097), which the sink sends as `runGroup: {id, index, total}` when opening the run and omits otherwise.

`json` is compared **exactly** (an unset optional field must be omitted, `null` must be sent as `null`); `query` and `headers`
only check the listed keys; header names are case-insensitive.

## `eval/*.json`

Pure scoring behaviour, no network:

- `judge-prompt-hash.json`: `hashes` maps a judge (`correctness`, `faithfulness`) to the fingerprint of its rubric.
- `retrieval-metrics.json`: each case has the item's `metadata`, the `retrieved` chunks and the `expect`ed scores of
  `RecallAtK(2)`, `RecallAtK(3)`, `MRR` and `HitRate`, in that order (an unlabelled item gets none).
- `judge-score.json`: each case gives a stub `client` (`model`, the raw `reply` and an optional `replyModel` the provider served)
  and the `expect`ed score of the judge for the shared `item`, or `expectError` when the reply is not a valid answer.
