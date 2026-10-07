# Data model

Technical reference for how MemTrace stores its data. Identity, workflow and evaluation data live in **PostgreSQL**; traces, scores and human labels live in **ClickHouse**. The two engines share no transactions, so columns that point across them hold an id the application resolves (marked **REF** below).

Click a table to see what it is, why it exists, how it relates to the rest and what its states mean.

<ClientOnly>
  <DataModelDiagram />
</ClientOnly>

## The story, end to end

### 1. Who gets in and what they see

Everything starts with a **person** (`users`) who signs in. They can belong to an **organization** (`organizations`), which groups the projects of a company or team, and have access to one or more **experiments** (`experiments`), which are the agents: each one is the workspace of one agent and also its card in the [assistants catalog](./assistants) (description, owner, team and lifecycle live on the experiment itself).

There are two levels of roles, and both exist for a reason (see question 1 below). What each role can do is not written in code: a **role** (`roles`) is a set of **permissions** (`role_permissions`) stored as data. See [Roles & permissions](./roles-and-permissions).

Roles can be assigned by hand or come from the company's identity provider (Entra ID, Okta, SailPoint): through the groups in the sign-in token, or through SCIM.

### 2. The agent connects

Each experiment has its **API keys** (`api_keys`). The agent sends its traces with one of them, which is how MemTrace knows which experiment they belong to. In ClickHouse the experiment is identified by its `service_name`, which appears as `ServiceName` in every data table. It is the tenant key: what one experiment writes never mixes with another.

### 3. Traces arrive

Each operation of the agent (a call to a model, a tool or a retriever) is a **span**. Spans are stored in `otel_traces` and grouped by `TraceId` into a complete **trace**. Traces expire after 30 days. From the spans, latency, tokens and cost are computed, and topics are extracted (`span_topics`).

### 4. Reviewing what arrived

Looking at traces by eye does not scale. To review them in series there are five pieces:

- **Rubric** (`score_configs`): defines what is scored and how. For example *correctness* as yes/no, or *tone* as a number from 1 to 5. Its description is the guide for whoever labels.
- **Queue** (`annotation_queues`): a batch of things to review, with the rubrics that apply and the instructions.
- **Items and reviews** (`annotation_queue_items` and `annotation_queue_claims`): each trace in the queue is an item, and each person who reviews it has their own review.
- **Reviewers** (`annotation_queue_reviewers`): who can annotate in each queue. It is an explicit list, not "any member".
- **Technical decision** (`annotation_queue_resolutions`): when reviewers disagree, the technical profile sets the final value of each criterion and, optionally, the correct answer. It is a separate layer: reviewers' labels are never touched.

When someone reviews, their answer is stored as an **annotation** in ClickHouse (`annotations`). The detail of each answer lives there; PostgreSQL only carries the workflow.

The 👍/👎 that **end users** give to an answer are a different thing: they are stored in ClickHouse as **user feedback** (`user_feedback`), tied to the trace of the answer, and have no rubric or MemTrace user behind them.

### 5. Turning what was reviewed into a dataset

A **dataset** (`datasets`) is a set of examples to evaluate the agent: an input and, optionally, the expected output. Every time you edit it a new **version** is created (`dataset_versions`), and the examples live inside that version (`dataset_items`). An old version never changes.

A reviewed trace can be promoted to a dataset. If the annotation says the answer was bad, you write the correct answer and it becomes an example. Only the technical profile does this, and only for rows with no open disagreement.

### 6. Evaluating a version

You run your agent against a dataset version. Each execution is a **run** (`dataset_runs`), which remembers the exact version it used. Each item produces results in `eval_items`, and each evaluator produces a score in `eval_scores`. At the end a summary per evaluator is stored in `eval_run_summaries`.

### 7. Checking whether the LLM judge is reliable

An LLM judge scores without supervision. To know whether it is right, it is compared with people. If the judge and the people use the same rubric (same `name` and same type), their scores are comparable. A random sample of a run is sent to a queue, and the agreement is measured.

## Frequently asked questions

### 1. Why are there memberships at both organization and experiment level?

Because they answer different questions.

**Organization** (`org_memberships`, role `org_admin`) manages *people, experiments and keys* across the whole organization: it creates experiments, invites anyone with the right role, and sees and revokes every API key. It **does not read traces or data**: to work in an experiment it also needs an experiment role.

**Experiment** (`experiment_memberships`, roles `technical` and `business`) limits access to one project and decides what the person does inside it. A person on one team sees only their agent, not the others.

If only the organization level existed, everyone would see every experiment in the company. If only the experiment level existed, every new project would require adding its owners one by one. With both, you can delegate by team without giving access to everything.

A person's effective permissions in an experiment are the union of those of their organization role and their experiment role.

### 2. Why `pending_invitations`?

Because the user does not exist until their first sign-in. If you invite someone who has no account yet, the invitation is stored by email and applied when that person first signs in. Then it is deleted.

### 3. What is the difference between a queue *item* and a *review*?

The **item** is what has to be reviewed (a trace, or an item of a run). The **review** (`claim`) is one person working on that item. An item with `required_annotations = 2` needs two completed reviews.

### 4. Why does an item's `completed` state look redundant?

Because it can be computed from the reviews. It is stored as a cache so it is not recomputed on every query. Only `skipped` is decided by a person: it is the only manual transition.

### 5. What is the difference between `annotations` and `eval_scores`?

Who scores. `annotations` are people. `eval_scores` are automatic evaluators (code or an LLM judge). They are compared because they use the same rubric name.

### 6. What is `origin_item_id`?

Every version of a dataset copies its items as new rows, so the `id` changes in every version. `origin_item_id` is the id of the original row and is kept across all copies. That is how you know an item is "the same" in two versions and see what changed.

### 7. Why does a deletion leave a trace?

A deleted item does not disappear: it is copied to the new version with `deleted_at` and `deleted_by`. The history then shows who removed it and when.

### 8. Why does `dataset_runs` have both `dataset_id` and `dataset_version_id`?

The version is what matters to reproduce a run. `dataset_id` lets you list a dataset's runs without going through its versions.

### 9. Why is a retracted annotation not deleted?

ClickHouse does not delete rows cheaply or immediately. Instead a new row is written with `IsDeleted = 1`, and reads ignore it.

### 10. Why does ClickHouse have no foreign keys to PostgreSQL?

They are two engines with no shared transactions. Columns such as `ConfigId` or `AnnotatorId` hold an id that the application resolves. The same goes for `TraceId` in `eval_items`: the item can arrive before its trace, so the join happens at query time.

### 11. Why does `custom_metrics` store no data?

It stores only the chart definition (what to measure and how to group). The data is computed from ClickHouse every time.

### 12. Why are roles in tables and not in code?

So adding a profile means adding rows, not touching routes. The code only asks "does this person have the `queue:curate` permission?". `roles` lists the roles and `role_permissions` the permissions of each one. Memberships (`org_memberships`, `experiment_memberships`) and invitations point to a role by name. Three ship with the installation: `org_admin`, `technical` and `business`.

### 13. How does it connect to the company's identity provider?

In two ways that can coexist. Both end in a single reconciliation that leaves the person's external memberships exactly as the mappings say.

**Token groups.** `external_mappings` says which group gives which role (in one experiment, or in the whole organization when `experiment_id` is empty). At sign-in the groups in the token are read; `organization_idp_settings` stores the name of the claim that carries them.

**SCIM.** The provider creates and deactivates people (`scim_users`) and pushes groups (`scim_groups`, `scim_group_members`) with a token (`scim_tokens`, hash only). Deprovisioning someone removes what SCIM had given them at once.

Every membership has a `source` column (`manual`, `oidc` or `scim`). Reconciliation only touches its own: a manual membership is never overwritten or removed, and the last `org_admin` of an organization is never removed.
