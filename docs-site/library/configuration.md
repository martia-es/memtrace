# Configuration

Settings can be passed to `init_tracer` or set as environment variables.

| Variable | Default | Description |
|---|---|---|
| `MEMTRACE_ENABLED` | `true` | `false` turns the SDK into a no-op |
| `MEMTRACE_SERVICE_NAME` | `default-agent` | OTel `service.name` |
| `MEMTRACE_SERVICE_VERSION`, `MEMTRACE_ENVIRONMENT` | none | Resource attributes |
| `MEMTRACE_GIT_SHA` | auto | Commit of the code that runs. If unset, the SDK reads `GIT_SHA`, `GITHUB_SHA`, `CI_COMMIT_SHA`, `VERCEL_GIT_COMMIT_SHA`, `RENDER_GIT_COMMIT` or `HEROKU_SLUG_COMMIT`, and as a last resort `git rev-parse HEAD`. Sent on every trace as `vcs.repository.ref.revision` |
| `MEMTRACE_OTLP_ENDPOINT` | `http://localhost:4317` (grpc), `:4318` (http) | Where to send traces |
| `MEMTRACE_OTLP_PROTOCOL` | `grpc` | Or `http/protobuf` (needs the `http` extra) |
| `MEMTRACE_OTLP_HEADERS` | none | `k1=v1,k2=v2` |
| `MEMTRACE_CAPTURE_CONTENT` | `false` | Store prompts, completions and tool arguments |
| `MEMTRACE_MAX_CONTENT_LENGTH` | `16384` | Truncation limit for captured content |
| `MEMTRACE_REDACT_KEYS` | none | Extra key names to mask in captured content, comma-separated (e.g. `ssn,phone`) |
| `MEMTRACE_SPAN_TTL_SECONDS` | `3600` | Closes orphaned spans (checked in the background too) |
| `MEMTRACE_MAX_ACTIVE_RUNS` | `10000` | Cap on in-flight spans; the oldest are closed early beyond it |
| `MEMTRACE_EXPORT_TIMEOUT_MS` | `5000` | Batch exporter timeout |
| `MEMTRACE_BATCH_MAX_QUEUE_SIZE` | `2048` | Batch queue size |
| `MEMTRACE_BATCH_SCHEDULE_DELAY_MS` | `5000` | Batch flush interval |
| `MEMTRACE_BATCH_MAX_EXPORT_SIZE` | `512` | Spans per export |
| `MEMTRACE_API_URL` | none | Query API base URL, including the experiment id; used by [offline evaluation](./evaluation#sending-results-to-memtrace) |
| `MEMTRACE_API_KEY` | none | Agent API key for the query API (the same key used for tracing) |
| `MEMTRACE_ALLOW_PROMPT_OVERRIDE` | `false` | Lets MemTrace's [playground](./prompts#try-a-version-in-the-real-agent) run another prompt version in this agent for one request. Turn it on in non-production environments only |
| `MEMTRACE_PROMPT_REFRESH_SECONDS`, `MEMTRACE_PROMPT_USAGE_SECONDS`, `MEMTRACE_PROMPT_TIMEOUT_SECONDS`, `MEMTRACE_PROMPT_CACHE_DIR` | `30`, `300`, `3`, none | How the [prompt registry](./prompts#configuration) is followed and reported |

For a self-signed TLS certificate, use an `https://` endpoint and the standard `OTEL_EXPORTER_OTLP_CERTIFICATE` variable.

## Privacy and content capture

By default MemTrace records **metadata only**: names, timings, models, token counts, errors. Prompts, completions and function arguments are stored only with `MEMTRACE_CAPTURE_CONTENT=true`, truncated to `MEMTRACE_MAX_CONTENT_LENGTH`. Without it there is no prompt or completion to show in conversation transcripts.

The automatic [Pydantic AI and LangChain integrations](./integrations) follow the same switch: they record no prompts or completions unless it is `true`.

### Redaction

Redaction runs on **every span before it leaves your process**, whatever created it: MemTrace decorators, the LangChain handler, Pydantic AI, or any auto-instrumented library. It applies to attributes, exception messages and error statuses, and it is on even when content capture is off.

What is masked as `****`:

- **By name**: any value whose key contains `api_key`, `password`, `secret`, `authorization`, `access_token`, `refresh_token`, `private_key`, `credential` or `cookie` (case-insensitive, at any depth). Add your own with `MEMTRACE_REDACT_KEYS`. `token` alone is not on the list, so `max_tokens` and `input_tokens` stay readable.
- **By shape**, anywhere in text, prompts included: OpenAI/Anthropic `sk-…` keys, AWS, GitHub, Google and Slack keys, JWTs, `Bearer …` tokens, MemTrace `mtk_…` keys, private key blocks, `user:password@` in URLs, and `password=…` style pairs.

Personal data with no fixed shape (names, emails, addresses) is not detected by default. To anonymize it, use the optional [`pii` extra](./pii) (`init_tracer(redact=presidio_redactor())`) or pass your own hook. A hook receives the content of each span (JSON-compatible data or text) and returns what to keep:

```python
init_tracer(redact=lambda content: scrub_pii(content))
```

If the hook raises, MemTrace stores a placeholder instead of the raw content.

## Code version on every trace

Every trace carries the commit of the code that produced it (`vcs.repository.ref.revision`), so you can tell which version answered what. The SDK finds the commit by itself; in a Docker image built by your CI you only need to pass it once:

```dockerfile
ARG GIT_SHA
ENV GIT_SHA=$GIT_SHA
```

```yaml
# GitHub Actions: the value is the commit being built, so it changes on every build
docker build --build-arg GIT_SHA=${{ github.sha }} -t my-assistant .
```

Platforms that already expose the commit (Vercel, Render, Heroku) need nothing. When running from a local checkout, the SDK also marks traces with `memtrace.revision.dirty` if there are uncommitted changes. Without a commit the traces are still sent, just without a version.
