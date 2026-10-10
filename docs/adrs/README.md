# Architecture Decision Records

An ADR records **why** an architecture-level decision was taken. It is not a feature spec, a UI convention or a changelog: those live in the code, in [docs-site/](../../docs-site/) (user-facing) and in [docs/ui-conventions.md](../ui-conventions.md).

## When to write one

Write an ADR only if **all** of these hold:

1. The decision is hard to reverse (a new store, a protocol, a data model, a security boundary, a public contract).
2. It affects more than one component, or it constrains future phases of [roadmap.md](../roadmap.md).
3. There were real alternatives and the reason for the choice would otherwise be lost.

Do **not** write one for a new screen, an endpoint that follows an existing pattern, a component or a naming convention. Put the explanation in `docs-site/` or `docs/ui-conventions.md`. Prefer **extending** an existing ADR (add a section and update its status) over creating a new one on the same topic.

## Rules

- File: `docs/adrs/<topic>/adr-NNN-short-title.md`, title in English, at most 500 lines. Topics: `infra`, `storage`, `sdk`, `api`, `identity`, `governance`, `observability`, `evaluation`, `datasets`, `prompts`, `pricing`, `ui`.
- Numbers are **stable identifiers** (code comments cite them as `ADR-0xx`). Never renumber and never reuse a number; take the next free one (the highest number below, plus one).
- Status is one of `Accepted`, `Superseded by ADR-NNN` or `Deprecated`. When an ADR stops being true, mark it or move it to the retired table below; do not leave it silently outdated.
- Relative links only, and they must resolve (`scripts/check-md-links.py` checks them in CI).
- Adding, superseding or retiring an ADR updates the tables in this file.

## Active ADRs

| ADR | Title | File |
|---|---|---|
| 001 | OpenTelemetry Collector and ClickHouse for Trace Ingestion and Storage | [infra/adr-001-otel-collector-clickhouse.md](infra/adr-001-otel-collector-clickhouse.md) |
| 002 | Local Kubernetes with k3d as the Runtime (Replaces Docker Compose) | [infra/adr-002-local-kubernetes-k3d.md](infra/adr-002-local-kubernetes-k3d.md) |
| 003 | Schema Owned by Versioned Migrations, Not by the Collector Exporter | [storage/adr-003-clickhouse-schema-and-migrations.md](storage/adr-003-clickhouse-schema-and-migrations.md) |
| 005 | Persistent Volumes for ClickHouse and Persistent Queue in the Collector | [infra/adr-005-persistent-storage-and-queue.md](infra/adr-005-persistent-storage-and-queue.md) |
| 006 | Diseñando el SDK Python de MemTrace inspirándose en LangSmith OTel Exporter | [sdk/adr-006-python-sdk-design.md](sdk/adr-006-python-sdk-design.md) |
| 007 | SDK Span Parenting via the OTel Context (no Deterministic IDs) | [sdk/adr-007-sdk-otel-context-bridge.md](sdk/adr-007-sdk-otel-context-bridge.md) |
| 009 | Query API Contract and `TraceRepository` Port | [api/adr-009-query-api-contract.md](api/adr-009-query-api-contract.md) |
| 013 | PostgreSQL Identity Store with Federated OAuth Login and Two-Level RBAC | [identity/adr-013-identity-postgres-and-oauth-rbac.md](identity/adr-013-identity-postgres-and-oauth-rbac.md) |
| 021 | SDK Hands Its Tracer Provider to Auto-Instrumentors and Redacts Captured Content | [sdk/adr-021-sdk-explicit-tracer-provider-and-content-redaction.md](sdk/adr-021-sdk-explicit-tracer-provider-and-content-redaction.md) |
| 022 | Topic Extraction with BERTopic, as an Async Enrichment Pipeline | [observability/adr-022-topic-extraction-bertopic.md](observability/adr-022-topic-extraction-bertopic.md) |
| 024 | Per-Framework Integration Packages Under a Public `memtrace.<framework>` Namespace | [sdk/adr-024-per-framework-integration-packages.md](sdk/adr-024-per-framework-integration-packages.md) |
| 025 | Model Pricing Catalog Synced from LiteLLM | [pricing/adr-025-model-pricing-catalog-sync.md](pricing/adr-025-model-pricing-catalog-sync.md) |
| 028 | Offline Evaluation as a Decoupled, Client-Side SDK Module | [evaluation/adr-028-offline-evaluation-decoupled-sdk.md](evaluation/adr-028-offline-evaluation-decoupled-sdk.md) |
| 031 | Dataset Versioning — Immutable Snapshots, Semver, Stable Item Identity and Publish per Session | [datasets/adr-031-dataset-versioning.md](datasets/adr-031-dataset-versioning.md) |
| 037 | Human Annotations — Storage in ClickHouse and Query API | [evaluation/adr-037-human-annotations-storage-and-api.md](evaluation/adr-037-human-annotations-storage-and-api.md) |
| 039 | Annotation Queues | [evaluation/adr-039-annotation-queues.md](evaluation/adr-039-annotation-queues.md) |
| 044 | Split Offline Evaluation Storage into `eval_items` and `eval_scores`; Read Latency, Tokens and Cost from the Linked Trace | [evaluation/adr-044-eval-items-and-scores-tables-telemetry-from-traces.md](evaluation/adr-044-eval-items-and-scores-tables-telemetry-from-traces.md) |
| 048 | Mediterranean Design System and Simplified Navigation | [ui/adr-048-mediterranean-design-system-and-simplified-navigation.md](ui/adr-048-mediterranean-design-system-and-simplified-navigation.md) |
| 052 | Permission-Based Roles and External Identity Mapping | [identity/adr-052-permission-based-roles-and-external-identity-mapping.md](identity/adr-052-permission-based-roles-and-external-identity-mapping.md) |
| 053 | Assistant Registry Data Model | [governance/adr-053-assistant-registry-data-model.md](governance/adr-053-assistant-registry-data-model.md) |
| 054 | An Experiment Is an Agent | [governance/adr-054-experiment-is-an-agent.md](governance/adr-054-experiment-is-an-agent.md) |
| 055 | Agent Chat Endpoint and Proxy | [governance/adr-055-agent-chat-endpoint-and-proxy.md](governance/adr-055-agent-chat-endpoint-and-proxy.md) |
| 062 | End-User Feedback on Traces | [observability/adr-062-end-user-feedback-on-traces.md](observability/adr-062-end-user-feedback-on-traces.md) |
| 064 | CI-Triggered Deployments with an Evaluation Gate | [governance/adr-064-ci-triggered-deployments-with-evaluation-gate.md](governance/adr-064-ci-triggered-deployments-with-evaluation-gate.md) |
| 065 | Code Revision on Traces and Evaluations | [observability/adr-065-code-revision-on-traces-and-evaluations.md](observability/adr-065-code-revision-on-traces-and-evaluations.md) |
| 067 | Prompt Registry — Immutable Versions, Movable Tags and Evidence per Version | [prompts/adr-067-prompt-registry-immutable-versions-and-tags.md](prompts/adr-067-prompt-registry-immutable-versions-and-tags.md) |
| 068 | Prompt Handle in the SDK, Trace Link and Usage Report | [prompts/adr-068-prompt-handle-trace-link-and-usage-report.md](prompts/adr-068-prompt-handle-trace-link-and-usage-report.md) |
| 070 | Prompt Promotion Gate | [prompts/adr-070-prompt-promotion-gate.md](prompts/adr-070-prompt-promotion-gate.md) |
| 071 | Prompt Playground Against the Real Agent | [prompts/adr-071-playground-against-the-real-agent.md](prompts/adr-071-playground-against-the-real-agent.md) |
| 072 | Drafts and Fixes from Failures | [prompts/adr-072-drafts-and-fixes-from-failures.md](prompts/adr-072-drafts-and-fixes-from-failures.md) |
| 073 | Reusable Fragments | [prompts/adr-073-reusable-fragments.md](prompts/adr-073-reusable-fragments.md) |
| 076 | Prompt Approvals (Publish and Promote Behind Rules) | [governance/adr-076-prompt-approvals.md](governance/adr-076-prompt-approvals.md) |
| 078 | Editable Data Catalog for Custom Charts | [ui/adr-078-editable-chart-catalog.md](ui/adr-078-editable-chart-catalog.md) |
| 084 | Data Protection — Retention, PII Masking, Audit Log and Export | [storage/adr-084-data-protection-retention-masking-audit-and-export.md](storage/adr-084-data-protection-retention-masking-audit-and-export.md) |
| 085 | The Ingest Gateway Validates the `service.name` Against the API Key | [identity/adr-085-ingest-gateway-validates-service-name.md](identity/adr-085-ingest-gateway-validates-service-name.md) |
| 086 | Alerts and Cost Budgets | [observability/adr-086-alerts-and-cost-budgets.md](observability/adr-086-alerts-and-cost-budgets.md) |

## Retired ADRs

These were removed in the documentation cleanup because they described features, conventions or implementation details, not architecture. The text is still in git history, at the last commit that contained them: `f3218a9` (for example `git show f3218a9:docs/adrs/ui/adr-080-own-button-component.md`). Code comments that cite one of these numbers remain valid as pointers to that history.

| ADR | Title | Where it lives now |
|---|---|---|
| 010 | Reduce ClickHouse Background Threads to Fit the Kind Node PID Limit | `k8s/config/` and [ADR-005](infra/adr-005-persistent-storage-and-queue.md) |
| 012 | Unified Span Tree View for a Conversation | Code and `docs-site/library/tracing.md` |
| 014 | Pending Invitations by Email for Users Without an Account Yet | Code and `docs-site/platform/access-control.md` |
| 016 | Admin Page Visible to Experiment Members, Scoped by Permission | Code and `docs-site/platform/access-control.md` |
| 017 | Dark Theme via `--mt-*` Design Tokens | [docs/ui-conventions.md](../ui-conventions.md) |
| 018 | Centralized Border-Radius Tokens | [docs/ui-conventions.md](../ui-conventions.md) |
| 019 | Per-Organization Theme via CSS Custom Property Overrides | [docs/ui-conventions.md](../ui-conventions.md) |
| 020 | Standalone Public Docs Site with VitePress | `docs-site/` and its README |
| 023 | Cross-Experiment Usage Endpoint for the Cost Comparison View | Code and `docs-site/platform/api.md` |
| 026 | Custom step trees via manual instrumentation | Code and `docs-site/library/tracing.md` |
| 027 | Custom metrics on user-defined spans | Code, `docs-site/library/evaluation.md`, `docs-site/platform/evaluation.md` and `docs-site/platform/annotations.md` |
| 029 | LLM-as-Judge Evaluators | Code, `docs-site/library/evaluation.md`, `docs-site/platform/evaluation.md` and `docs-site/platform/annotations.md` |
| 030 | Expand the custom charts builder (still closed, not a free query builder) | Code, `docs-site/library/evaluation.md`, `docs-site/platform/evaluation.md` and `docs-site/platform/annotations.md` |
| 032 | Automatic Dataset Versioning (Semver) and Per-Item Audit Trail | [ADR-031](datasets/adr-031-dataset-versioning.md) (consolidated) |
| 033 | Stable Item Identity and Server-Side Version Diff | [ADR-031](datasets/adr-031-dataset-versioning.md) (consolidated) |
| 034 | Runs Always Record Their Dataset Version and Upload Incrementally | Code, `docs-site/library/evaluation.md`, `docs-site/platform/evaluation.md` and `docs-site/platform/annotations.md` |
| 035 | Saved metric reports (grid of custom charts, emailed as a snapshot) | Code, `docs-site/library/evaluation.md`, `docs-site/platform/evaluation.md` and `docs-site/platform/annotations.md` |
| 036 | Score Configs (Annotation Rubrics) | Code, `docs-site/library/evaluation.md`, `docs-site/platform/evaluation.md` and `docs-site/platform/annotations.md` |
| 038 | Promote an Annotated Trace to a Dataset Item | [ADR-031](datasets/adr-031-dataset-versioning.md) (consolidated) |
| 040 | Judge-vs-Human and Inter-Annotator Agreement | Code, `docs-site/library/evaluation.md`, `docs-site/platform/evaluation.md` and `docs-site/platform/annotations.md` |
| 041 | Spreadsheet-Style Item Editing with One Version per Published Session | [ADR-031](datasets/adr-031-dataset-versioning.md) (consolidated) |
| 042 | Offline Evaluation Storage Model — Known Limitations and Target Direction | Code, `docs-site/library/evaluation.md`, `docs-site/platform/evaluation.md` and `docs-site/platform/annotations.md` |
| 043 | Record Judge Identity (Model and Rubric Fingerprint) on Scores | Code, `docs-site/library/evaluation.md`, `docs-site/platform/evaluation.md` and `docs-site/platform/annotations.md` |
| 045 | Evaluation Follow-ups: Retrieval Metrics, Stored Run Summaries, Retention, and a Write-only ClickHouse User | Code, `docs-site/library/evaluation.md`, `docs-site/platform/evaluation.md` and `docs-site/platform/annotations.md` |
| 046 | Admin Area as Hierarchical, Step-by-Step Navigation | [docs/ui-conventions.md](../ui-conventions.md) |
| 047 | Arquitectura del asistente del tiempo (Pydantic AI + FastAPI + UI estática) | `weather_assistant/README.md` |
| 049 | Conversation Title and Cost, and Low-Rated Traces for "Needs attention" | Code and `docs-site/platform/api.md` |
| 050 | Queue Results and Curation for Technical Roles | Code, `docs-site/library/evaluation.md`, `docs-site/platform/evaluation.md` and `docs-site/platform/annotations.md` |
| 051 | Explicit Reviewers per Annotation Queue | Code, `docs-site/library/evaluation.md`, `docs-site/platform/evaluation.md` and `docs-site/platform/annotations.md` |
| 056 | MCP server name on tool spans | Code and `docs-site/library/tracing.md` |
| 057 | Business vocabulary and question templates for Custom charts | [docs/ui-conventions.md](../ui-conventions.md) |
| 058 | Global topbar fed by the pages | [docs/ui-conventions.md](../ui-conventions.md) |
| 059 | Sidebar submenus instead of tabs inside pages | [docs/ui-conventions.md](../ui-conventions.md) |
| 060 | Per-Evaluator Pass Rate Target on Score Configs | Code, `docs-site/library/evaluation.md`, `docs-site/platform/evaluation.md` and `docs-site/platform/annotations.md` |
| 061 | Reviewed Reply as Expected Output and a Full-Size Resolve View | Code, `docs-site/library/evaluation.md`, `docs-site/platform/evaluation.md` and `docs-site/platform/annotations.md` |
| 063 | Assistant Display Modes and Extended Organization Theme | [docs/ui-conventions.md](../ui-conventions.md) |
| 066 | Business-Language Error Overview Without AI | Code and `docs-site/library/tracing.md` |
| 069 | Evidence per Prompt Version | Code and `docs-site/platform/prompts.md` |
| 071 | Release board for the prompt list and a vertical version rail in the prompt page (the number was used twice; the active ADR-071 is the playground) | [docs/ui-conventions.md](../ui-conventions.md) |
| 074 | Prompt Dependency Map | Code and `docs-site/platform/prompts.md` |
| 075 | Replay Earlier Turns in the Playground | Code and `docs-site/platform/prompts.md` |
| 077 | Pick a failure to fix from four existing signals | Code and `docs-site/platform/prompts.md` |
| 079 | Making the Data Catalog Discoverable | [docs/ui-conventions.md](../ui-conventions.md) |
| 080 | One own `Button` component, no Quasar buttons | [docs/ui-conventions.md](../ui-conventions.md) |
| 081 | Own `Checkbox`, `Radio` and `Pill` components | [docs/ui-conventions.md](../ui-conventions.md) |
| 082 | Own `DataTable`, `Card`, `Pagination` and `FormField` components | [docs/ui-conventions.md](../ui-conventions.md) |
| 083 | Own interaction widgets and no Quasar visual components | [docs/ui-conventions.md](../ui-conventions.md) |

## Numbers cited but never committed

ADR-004 (GenAI semantic conventions and content capture), ADR-008 (SDK hexagonal layout: `domain` → `application` → `adapters`), ADR-011 (dashboard architecture) and ADR-015 appear in code comments, but their files were never added to the repository. Their substance is in [phase_1_design.md](../archive/phase_1_design.md), [ADR-006](sdk/adr-006-python-sdk-design.md), [ADR-021](sdk/adr-021-sdk-explicit-tracer-provider-and-content-redaction.md) and [dashboard/README.md](../../dashboard/README.md). Do not reuse these numbers.
