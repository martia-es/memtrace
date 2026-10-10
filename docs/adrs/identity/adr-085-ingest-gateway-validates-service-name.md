# ADR-085: The Ingest Gateway Validates the `service.name` Against the API Key

* **Status**: Accepted
* **Date**: 2026-10-10
* **Deciders**: MemTrace Core Team
* **Extends**: [ADR-013](adr-013-identity-postgres-and-oauth-rbac.md)
* **Related**: [ADR-084](../storage/adr-084-data-protection-retention-masking-audit-and-export.md)

## Context and Problem Statement

The ingest gateway (`POST /api/v1/ingest/v1/traces`, piece 9 of ADR-013) checked that an API key was valid and then forwarded the OTLP body untouched. It did not look inside, so a key of experiment A could write traces with the `service.name` of experiment B. In ClickHouse the experiment *is* its `ServiceName`: every query, the retention job and the audit trail of ADR-084 are scoped by it. A valid key could therefore pollute another agent's metrics, make its data survive or expire under the wrong policy, and write under a name it does not own.

## Decision Outcome

The gateway now reads the `service.name` of **every resource** in the request and refuses the whole request unless all of them are exactly the `service.name` of the experiment that owns the key.

| Situation | Answer |
|---|---|
| Every resource carries the key's `service.name` | Forwarded to the Collector, byte for byte, with its original `Content-Type` and `Content-Encoding` |
| A resource carries another name, none, an empty one or one that is not text | `403`, nothing is forwarded (one foreign resource refuses the whole request) |
| Two `service.name` in one resource | `400`: the store would keep one and the gate could have read the other |
| Not valid OTLP, or invalid/oversized gzip | `400` |
| `Content-Encoding` other than `gzip` or none | `415`: it could not be checked, so it is not forwarded |
| Body over 16 MiB, or over 64 MiB once decompressed | `413` / `400` |
| A request with no resources | Forwarded: it writes nothing |

The comparison is exact (case, whitespace and look-alike characters do not match).

### How it reads the request

A small reader (`domain/otlp-resource.ts`) walks the protobuf wire format just far enough to find `ResourceSpans → Resource → attributes → service.name`, and skips everything else by its length. It never decodes a span and has no dependency. OTLP/JSON is read with `JSON.parse`. gzip is inflated with a hard output limit so a small body cannot expand without bound. The original bytes, not the decoded ones, are what is forwarded, so the Collector sees exactly what the agent sent.

Measured on a 21 MiB request of 5,000 spans: reading the resource header takes 0.012 ms (copying the body takes 3 ms); inflating gzip takes 22 ms, and only when the agent compresses (the Python SDK does not by default).

## Considered Options

* **Do it in the Collector** (a processor that drops spans with a wrong name). It has no notion of which key was used; the key is only known at the gateway.
* **Decode the request with a protobuf library.** Heavier, new dependency, decodes every span to read one header field.
* **Rewrite the `service.name` to the key's one instead of refusing.** Hides a misconfigured agent instead of telling its owner, and would silently merge two agents' data.
* **Only log a warning.** Does not close the hole.

## Consequences

* A key can no longer write into another experiment. The retention job, the audit log and every query can rely on `ServiceName`.
* **Behavior change**: an agent whose `service.name` differs from the one registered for its experiment (or that sets none) now gets `403` instead of being accepted. The error message says which name to use.
* Two organizations may still register the same `service.name` (the identity schema only requires it to be unique inside an organization). Each key then writes under that shared name; ADR-084 explains which retention applies. Making the name globally unique is a separate decision.
* The gRPC receiver of the Collector does not pass through this gateway. It is a `ClusterIP` service, reachable only from inside the cluster; closing it for good is a NetworkPolicy, not application code.
