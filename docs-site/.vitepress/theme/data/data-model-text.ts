/** English text for the data model diagram. Structure (fields, positions, relations) lives in data-model.json. */
export interface TableText {
  /** one line shown on the table card */
  short: string;
  /** what it is */
  what: string;
  /** why it exists */
  why: string;
  /** how it relates to the rest */
  relations: string[];
  /** states or values worth knowing: [value, meaning] */
  states?: [string, string][];
}

export const TEXT: Record<string, TableText> = {
  users: {
    short: "Person who signs in",
    what: "A person with an account in MemTrace.",
    why: "It is where permissions start. The account is created on the first sign-in.",
    relations: ["Belongs to organizations (org_memberships) and to experiments (experiment_memberships).", "May also come from an external identity provider (scim_users).", "Appears as author in almost every table (created_by, added_by…)."],
  },
  organizations: {
    short: "Groups experiments",
    what: "A company or large team that groups experiments.",
    why: "It lets you manage several projects from one place: who manages people and keys, and which projects exist.",
    relations: ["Has many experiments.", "Organization invitations are stored in pending_invitations.", "Its external identity lives in external_mappings, organization_idp_settings, scim_tokens, scim_users and scim_groups."],
  },
  org_memberships: {
    short: "Organization role",
    what: "Link person ↔ organization with an organization role.",
    why: "It gives control over the people, experiments and keys of the whole organization without adding the person experiment by experiment. It does not give access to data.",
    relations: ["Links users with organizations.", "role points to roles.", "source says whether a person or the identity provider set it."],
    states: [
      ["org_admin", "Creates experiments, invites anyone with the right role, and sees and revokes every API key. Does not read traces or data."],
      ["source = manual", "Assigned by a person. Reconciliation never touches it."],
      ["source = oidc / scim", "Managed by the identity provider: added and removed automatically from its groups."],
    ],
  },
  experiments: {
    short: "Workspace and tenant",
    what: "One agent or project with its own traces, datasets, rubrics and queues.",
    why: "It is the data boundary: everything stored is tagged with its service_name, so it never mixes with another experiment.",
    relations: ["Belongs to an organization.", "Has its own API keys, members, datasets, rubrics, queues and charts.", "Its service_name is the ServiceName key in ClickHouse."],
  },
  experiment_memberships: {
    short: "Role per experiment",
    what: "Link person ↔ experiment with an experiment role.",
    why: "It limits access to one project and decides what the person can do inside it, so a team sees only its own agent.",
    relations: ["Links users with experiments.", "role points to roles.", "source says whether a person or the identity provider set it."],
    states: [
      ["technical", "The whole dashboard, including the technical trace, plus what shapes the review: queues, rubrics, results, datasets and their own API key."],
      ["business", "The whole dashboard read-only (metrics, costs, automatic evaluations), with traces shown as a conversation. Labels in the queues they review."],
      ["source = manual", "Assigned by a person. Reconciliation never touches it."],
      ["source = oidc / scim", "Managed by the identity provider."],
    ],
  },
  api_keys: {
    short: "Agent credential (hash)",
    what: "Credential an agent uses to send traces to an experiment.",
    why: "It authenticates ingestion without personal accounts. Only the hash is stored: the plaintext key is shown once.",
    relations: ["Belongs to an experiment.", "key_prefix lets you recognize it in the interface."],
    states: [
      ["active", "revoked_at is empty: the agent can send traces."],
      ["revoked", "revoked_at has a date: the key is disabled. The row is kept as history."],
    ],
  },
  pending_invitations: {
    short: "Invitation before first sign-in",
    what: "Invitation to a person who does not have an account yet.",
    why: "Auth.js does not create the user until the first sign-in, so the invitation is stored by email and applied then.",
    relations: ["Points to an organization (role org_admin) or to an experiment (technical or business).", "role points to roles."],
  },
  roles: {
    short: "Role catalog",
    what: "The catalog of roles: org_admin, technical, business and any you add.",
    why: "It makes a role data instead of code. Adding a profile means adding rows.",
    relations: ["Its permissions are in role_permissions.", "Memberships, invitations and external mappings point to a role by name."],
    states: [
      ["organization", "Can be assigned in an organization."],
      ["experiment", "Can be assigned in an experiment."],
      ["builtin", "Roles that ship with the installation."],
    ],
  },
  role_permissions: {
    short: "Permissions of each role",
    what: "A permission granted to a role, for example technical → queue:curate.",
    why: "It is the only thing the code consults to decide whether to allow something. The catalog is on the Roles & permissions page.",
    relations: ["Belongs to a role."],
  },
  external_mappings: {
    short: "External group → role",
    what: "Which group of the identity provider gives which role.",
    why: "It lets a company manage who does what from its own Entra ID, Okta or SailPoint. If experiment_id is empty the role applies to the whole organization.",
    relations: ["Belongs to an organization and, optionally, to an experiment.", "role points to roles.", "Used by sign-in (token groups) and by SCIM (pushed groups)."],
  },
  organization_idp_settings: {
    short: "Organization's groups claim",
    what: "The name of the token claim that carries the groups in this organization.",
    why: "Entra usually uses groups or roles; other providers use another name. With no row, groups is used.",
    relations: ["One row per organization."],
  },
  scim_tokens: {
    short: "SCIM credential (hash)",
    what: "Credential the identity provider uses to speak SCIM with an organization.",
    why: "It authenticates synchronization without personal accounts. Only the hash is stored: the plaintext is shown once.",
    relations: ["Belongs to an organization: it only sees that organization."],
    states: [
      ["active", "revoked_at is empty."],
      ["revoked", "revoked_at has a date: the provider can no longer synchronize."],
    ],
  },
  scim_users: {
    short: "Person pushed by SCIM",
    what: "A person as the identity provider knows them.",
    why: "It allows provisioning and deprovisioning without waiting for the first sign-in. user_name must be the email the person signs in with; that is how it links to their account, now or at first sign-in.",
    relations: ["Belongs to an organization.", "user_id points to users once there is an account.", "Belongs to groups (scim_group_members)."],
    states: [
      ["active", "The provider has it active: it keeps the roles its groups give."],
      ["inactive", "active = false: loses whatever SCIM had given, immediately."],
    ],
  },
  scim_groups: {
    short: "Group pushed by SCIM",
    what: "A group as the identity provider knows it.",
    why: "Its display_name or external_id is compared with the groups in external_mappings to know which role applies.",
    relations: ["Belongs to an organization.", "Has members (scim_group_members)."],
  },
  scim_group_members: {
    short: "Who is in each SCIM group",
    what: "Who belongs to each SCIM group.",
    why: "When someone joins or leaves a group, their access is recalculated at once.",
    relations: ["Links scim_groups with scim_users."],
  },
  custom_metrics: {
    short: "Saved chart over spans",
    what: "A saved chart over an experiment's spans.",
    why: "It stores only the definition (what to measure, filters, grouping). The data is computed from ClickHouse when it is opened.",
    relations: ["Belongs to an experiment.", "Can appear in several reports."],
  },
  metric_reports: {
    short: "Report with several charts",
    what: "A panel with several charts placed on a grid.",
    why: "It groups charts into one view. The chart is not duplicated: the report only stores where and at what size it appears.",
    relations: ["Contains metric_report_charts."],
  },
  metric_report_charts: {
    short: "12-column grid placement",
    what: "Placement of a chart inside a report.",
    why: "It separates the chart definition (custom_metrics) from its position, so a change to the chart shows in every report that uses it.",
    relations: ["Links metric_reports with custom_metrics."],
  },
  datasets: {
    short: "Named set of examples",
    what: "A named set of examples to evaluate the agent.",
    why: "It is the stable container. Its content changes in versions, but the name and identifier stay.",
    relations: ["Has many versions.", "Can have evaluation runs."],
  },
  dataset_versions: {
    short: "Immutable snapshot, semver",
    what: "An immutable snapshot of a dataset's examples.",
    why: "It makes evaluations reproducible: a run always points to a version that does not change. Editing does not overwrite, it creates another version.",
    relations: ["Contains dataset_items.", "A dataset_run points to a specific version."],
    states: [
      ["major +1", "An item was added or deleted."],
      ["minor +1", "Only the content of existing items was edited."],
    ],
  },
  dataset_items: {
    short: "Example inside a version",
    what: "An example inside a version: an input and, if known, the expected output.",
    why: "They are the rows of the snapshot. origin_item_id keeps identity across versions, and deletion is recorded (deleted_at, deleted_by).",
    relations: ["Belongs to a version.", "If it comes from a trace, metadata.promotedFrom says which one."],
  },
  dataset_runs: {
    short: "Execution against a version",
    what: "One execution of an evaluation against a dataset version.",
    why: "It ties the result to the exact version used, so runs can be compared and repeated. Items arrive in batches while it runs.",
    relations: ["Points to a version and to a dataset.", "Its items and scores live in ClickHouse (eval_items, eval_scores).", "Review queues can point to its items."],
    states: [
      ["running", "Still receiving items, or the process was interrupted halfway. It can stay like this."],
      ["completed", "All items arrived. The summary is already computed."],
    ],
  },
  score_configs: {
    short: "Rubric: what is scored and how",
    what: "The experiment's rubric: what is scored and how.",
    why: "It gives scores a common meaning. A human and a judge with the same name and type are comparable. Its type never changes once created.",
    relations: ["Used in queues (annotation_queue_configs), in annotations (ConfigId) and in resolutions (annotation_queue_resolutions)."],
    states: [
      ["numeric", "A number between min and max."],
      ["boolean", "Yes or no."],
      ["categorical", "One of several defined categories."],
      ["active", "archived_at is empty: can be used in new queues."],
      ["archived", "No longer used in new queues. Its name is freed. Old annotations still reference it."],
    ],
  },
  annotation_queues: {
    short: "Review batch",
    what: "A batch of work: what to review, with which rubrics and instructions.",
    why: "It organizes review so nothing is repeated or forgotten, and lets you ask for several reviews per item.",
    relations: ["Has rubrics (annotation_queue_configs), items and reviewers (annotation_queue_reviewers)."],
    states: [["required_annotations", "Number of complete reviews each item needs (1 to 10)."]],
  },
  annotation_queue_configs: {
    short: "Queue rubric",
    what: "The rubrics a queue applies, in order.",
    why: "A queue can ask for several scores. required says whether the rubric must be filled to complete the item.",
    relations: ["Links annotation_queues with score_configs."],
  },
  annotation_queue_items: {
    short: "What to review (ids only)",
    what: "A specific object to review inside a queue: a trace or a run item.",
    why: "It stores only the id, not the content, so the queue stays light and the trace stays in ClickHouse. population explains how it got there (by hand, by filter or by random sample).",
    relations: ["Belongs to a queue.", "Has reviews (claims).", "trace_id points to a trace in ClickHouse."],
    states: [
      ["pending", "Does not have all the needed reviews yet."],
      ["completed", "Has the needed reviews. It is a cache: the application computes it."],
      ["skipped", "A technical profile marked it as not reviewable. It is the only manual transition."],
    ],
  },
  annotation_queue_claims: {
    short: "One review per person and item",
    what: "One person's review of an item.",
    why: "It lets two people review the same item without stepping on each other, and counts how many reviews there are.",
    relations: ["Links an item with a person."],
    states: [
      ["in progress", "claimed_at set, with no completed_at or skipped_at."],
      ["completed", "completed_at set: the person submitted their answer."],
      ["skipped", "skipped_at set: the person decided not to review it."],
    ],
  },
  annotation_queue_reviewers: {
    short: "Who can annotate in the queue",
    what: "The people who can annotate in a queue.",
    why: "A queue says who can annotate, not only how many people are needed. Being a member of the experiment is not enough. Only experiment members can be chosen.",
    relations: ["Links annotation_queues with users.", "The number of reviewers cannot be lower than required_annotations."],
  },
  annotation_queue_resolutions: {
    short: "Technical decision per criterion",
    what: "The technical profile's decision on one criterion of an item, when a final value has to be set.",
    why: "Reviewers' labels live in ClickHouse and are not touched: this is a separate layer, attributed to whoever resolves. The correct answer used when the item is promoted to a dataset is stored here too.",
    relations: ["Links an item with a rubric (score_configs).", "resolved_by points to who decided."],
  },
  otel_traces: {
    short: "OpenTelemetry spans · 30 d TTL",
    what: "Each span of the agent: a call to a model, a tool or a retriever.",
    why: "It is the source of truth for what the agent did. Latency, tokens and cost are computed from here. It expires after 30 days.",
    relations: ["Several spans with the same TraceId form a trace.", "Reviews and evaluation items point to TraceId."],
  },
  otel_traces_trace_id_ts: {
    short: "Materialized range view",
    what: "Helper index: start and end of each trace.",
    why: "It lets you locate a trace without scanning the whole table. It fills itself.",
    relations: ["Fed by otel_traces."],
  },
  span_topics: {
    short: "Topic per span · 30 d TTL",
    what: "Topic that a worker extracts from a span's response.",
    why: "It lets you group conversations by topic without reading the text. It is not written by the Collector but by a separate process.",
    relations: ["Joins otel_traces by TraceId and SpanId."],
  },
  model_pricing: {
    short: "Price per token (LiteLLM)",
    what: "Price per token of each model.",
    why: "It turns tokens into cost. It is a reference table updated from LiteLLM; it stores no traces.",
    relations: ["Used to compute span cost, by ModelId."],
  },
  eval_items: {
    short: "Run item · texts 180 d TTL",
    what: "One item of a run: what went in, what came out and what was expected.",
    why: "The text is stored once even if there are several evaluators. Texts expire after 180 days; scores do not.",
    relations: ["Belongs to a run (DatasetRunId).", "TraceId links to the trace, where latency and cost are."],
  },
  eval_scores: {
    short: "Score per item and evaluator",
    what: "One evaluator's score on an item.",
    why: "Value keeps the text as is; ValueNum the number, so it can be averaged. JudgeModel and JudgePromptHash say which judge scored it.",
    relations: ["Belongs to an item (DatasetRunId + ItemIndex).", "Shares Name with annotations.ConfigName so judge and human can be compared."],
  },
  eval_run_summaries: {
    short: "Aggregate per run and evaluator",
    what: "A run's summary for one evaluator: total, average or pass rate.",
    why: "It lets you show trends without recomputing. It is written once when the run completes, so a resent batch is not counted twice.",
    relations: ["Aggregates the eval_scores of a run."],
  },
  annotations: {
    short: "Human labels · no TTL",
    what: "One person's label on a trace, with a rubric.",
    why: "It is the human data that serves as reference. If someone changes their answer, the previous one is replaced. If they withdraw it, it is marked IsDeleted. It never expires.",
    relations: ["ConfigId points to score_configs.", "AnnotatorId points to the user.", "TraceId points to the reviewed trace."],
    states: [
      ["current", "IsDeleted = 0: it is that person's current answer."],
      ["withdrawn", "IsDeleted = 1: it was withdrawn. Reads ignore it."],
    ],
  },
};
