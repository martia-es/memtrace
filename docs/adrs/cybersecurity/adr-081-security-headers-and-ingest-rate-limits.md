# ADR-081: Security Headers and Ingest Rate Limits

* **Status**: Accepted — implemented (2026-10-10). TLS itself and a general API rate limit are still open
* **Date**: 2026-10-10
* **Deciders**: MemTrace Core Team
* **Parent**: [ADR-076](adr-076-multi-tenant-security-baseline.md)

## Context and Problem Statement

Two P1 items of ADR-076 were cheap to close and reduce real risk:

- The dashboard and docs nginx sent no security headers: no Content-Security-Policy, no framing protection, no `nosniff`. A single XSS in a dashboard that shows prompts and completions captured from third parties would run with the session of an `org_admin`.
- The ingest gateway accepted any number of requests per key and any number of invalid keys per origin. A looping agent or a leaked key could saturate the Collector, and nothing slowed down key guessing.

## Decision Outcome

### Headers

| Where | Headers |
|---|---|
| Dashboard nginx (every `location`) | `Content-Security-Policy` (`default-src 'self'`, `script-src 'self'`, no remote origins, `object-src 'none'`, `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` |
| Docs nginx | the same set; the CSP allows inline scripts because VitePress needs them for its theme switch (the site is public and static) |
| API (`next.config.ts`, `/api/*`) | `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin`, `default-src 'none'` |

Details that matter:

- nginx replaces the `add_header` of the parent level when a `location` defines its own (the dashboard sets `Cache-Control` in two of them), so the headers live in one file included in **every** location; a test fails if one is missing.
- The CSP does not set `form-action`: the OIDC login is a form POST that the server redirects to Google or Microsoft, and browsers apply `form-action` to the redirect.
- `style-src` keeps `'unsafe-inline'` because the UI library writes inline styles; scripts stay strict.
- **HSTS is not set by the app.** Browsers ignore it over plain HTTP; whoever terminates TLS (the ingress) sets it. TLS termination is still a P1 item.

### Rate limits at the ingest gateway

- **Per experiment**: 600 requests per minute by default (`INGEST_RATE_LIMIT_PER_MINUTE`). An SDK batches every few seconds, so normal traffic is far below. Over the limit: `429` with `Retry-After`.
- **Invalid keys per origin**: 30 per minute (`INGEST_INVALID_KEY_LIMIT_PER_MINUTE`). Once an origin has used them, further attempts are refused with `429` **before** any database query. A valid key never counts against it.
- The origin is the **last** hop of `X-Forwarded-For`, which our nginx appends; anything to its left is written by the client, so inventing addresses does not evade the block.
- Fixed window, in memory of each replica: with N replicas the effective limit is N times higher and a restart clears it. It protects against abuse and misconfiguration, it is not a billing quota. Memory is bounded (10 000 keys, oldest evicted).

## Verification

- `tests/security-headers.test.ts`: every nginx `location` includes the snippet, the Dockerfiles ship it, the policy has no remote origin and no `unsafe` script source, and the API sets its headers.
- **Real Chromium** against the built dashboard served with the exact headers of the snippet: the login screen renders (62 elements) with zero policy violations, and an injected inline script is blocked and reported, so the policy is active and violations would be seen.
- `tests/http/ingest-rate-limit.test.ts` and `tests/application/rate-limiter.test.ts`: per-experiment limit with `Retry-After` and independence between experiments, invalid-key block without touching the database, spoofed `X-Forwarded-For` does not evade it, valid keys are not penalized, bounded memory.

## Not done

- Only the login screen was checked in a browser. Authenticated screens (charts, the chat panel) could still hit the CSP; the browser console shows violations immediately, and `Content-Security-Policy-Report-Only` is the way to try a stricter policy.
- No general rate limit on the rest of the API, and none on login (delegated to Google/Microsoft).
- nginx itself was not started (no nginx binary or Docker in the build environment); the headers were served by a script that reads the same snippet.

## Consequences

- **Positive**: an XSS has far less room to act, the app cannot be framed, key guessing is cheap to refuse, a runaway agent cannot starve the others.
- **Negative**: a new third-party script or font origin in the dashboard needs a deliberate policy change; per-replica counters are approximate.
