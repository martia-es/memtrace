import { describe, expect, it } from "vitest";
import { ApprovalRuleResolver } from "@/application/approval-rules";
import { ApprovalService } from "@/application/approval-service";
import type { ApprovalRepository, NewApprovalRequest } from "@/application/ports/approval-repository";
import type { PromptRepository } from "@/application/ports/prompt-repository";
import type { PromptGatePort } from "@/application/prompt-gate-service";
import { PromptService } from "@/application/prompt-service";
import type { ApprovalAction, ApprovalDecision, ApprovalRequest, ApprovalRule, ApprovalScope, ApprovalStatus, ApproverInfo } from "@/domain/approval";
import { ApprovalNotAllowedError, ApprovalRequiredError, PromptGateBlockedError, PromptInvariantError, ValidationError } from "@/domain/errors";
import type { GateRecord, Prompt, PromptTagEvent, PromptVersion } from "@/domain/prompt";
import type { PromptGateResult } from "@/domain/prompt-gate";

const ORG = "org-1";
const AGENT = "agent-a";
const OTHER_AGENT = "agent-b";
const ANA = "ana"; // technical
const BEN = "ben"; // technical
const CRIS = "cris"; // business
const ZOE = "zoe"; // technical, la que pide

const PEOPLE: ApproverInfo[] = [
  { userId: ANA, roles: ["technical"] },
  { userId: BEN, roles: ["technical"] },
  { userId: CRIS, roles: ["business"] },
  { userId: ZOE, roles: ["technical"] },
];

/** Repositorio de aprobaciones en memoria con las mismas reglas que el de Postgres. */
function fakeApprovals() {
  const rules = new Map<string, ApprovalRule>();
  const requests = new Map<string, ApprovalRequest>();
  const claimed = new Set<string>();
  let seq = 0;
  const key = (s: ApprovalScope, a: string, stage: string) => `${s.type}:${s.id}:${a}:${stage}`;
  const repo: ApprovalRepository = {
    listRules: async (scope) => [...rules.entries()].filter(([k]) => k.startsWith(`${scope.type}:${scope.id}:`)).map(([, r]) => r),
    setRule: async (scope, rule) => {
      rules.set(key(scope, rule.action, rule.stage), rule);
      return rule;
    },
    deleteRule: async (scope, action, stage) => rules.delete(key(scope, action, stage)),
    rulesFor: async (org, experiments, action, stage) =>
      [key({ type: "organization", id: org }, action, stage), ...experiments.map((e) => key({ type: "experiment", id: e }, action, stage))].map((k) => rules.get(k)).filter((r): r is ApprovalRule => !!r),
    approvers: async () => PEOPLE,
    approverCandidates: async () => PEOPLE.map((p) => ({ ...p, email: `${p.userId}@x.io`, name: p.userId })),
    experimentRoleNames: async () => ["business", "technical"],
    createRequest: async (input: NewApprovalRequest) => {
      const open = [...requests.values()].find((r) => r.promptId === input.promptId && r.action === input.action && r.version === input.version && r.tag === input.tag && (r.status === "pending" || r.status === "approved"));
      if (open) return null;
      const request: ApprovalRequest = {
        id: `r${++seq}`, promptId: input.promptId, action: input.action, version: input.version, tag: input.tag, note: input.note, bypassReason: input.bypassReason,
        requestedBy: input.requestedBy, status: "pending", executionError: null, createdAt: "t", expiresAt: input.expiresAt, decidedAt: null, executedAt: null,
        extraApprovers: input.extraApprovers, decisions: [],
      };
      requests.set(request.id, request);
      return request;
    },
    getRequest: async (id) => requests.get(id) ?? null,
    listRequests: async (promptId) => [...requests.values()].filter((r) => r.promptId === promptId),
    listOpenForOrganization: async () => [...requests.values()].filter((r) => r.status === "pending" || r.status === "approved"),
    saveDecision: async (id, d) => {
      const r = requests.get(id)!;
      r.decisions = [...r.decisions.filter((x) => x.userId !== d.userId), { ...d, decidedAt: "t" } as ApprovalDecision];
    },
    addExtraApprover: async (id, userId) => {
      const r = requests.get(id)!;
      if (!r.extraApprovers.includes(userId)) r.extraApprovers.push(userId);
    },
    claimExecution: async (id) => {
      // síncrono entre comprobar y marcar: igual de atómico que el UPDATE condicional de Postgres
      const r = requests.get(id);
      if (!r || (r.status !== "pending" && r.status !== "approved") || claimed.has(id)) return false;
      claimed.add(id);
      return true;
    },
    releaseExecution: async (id) => {
      claimed.delete(id);
    },
    setStatus: async (id, status: ApprovalStatus, patch = {}) => {
      const r = requests.get(id)!;
      r.status = status;
      if (patch.executionError !== undefined) r.executionError = patch.executionError;
    },
  };
  return { repo, rules, requests };
}

/** Repositorio de prompts mínimo: lo que usan PromptService y el servicio de aprobaciones. */
function fakePrompts() {
  const prompt: Prompt = { id: "p1", organizationId: ORG, kind: "prompt", name: "greeter", description: "", archivedAt: null, createdBy: ANA, createdAt: "t", updatedAt: "t", experimentIds: [AGENT, OTHER_AGENT] };
  const versions: PromptVersion[] = [];
  const tags = new Map<string, number>();
  const events: PromptTagEvent[] = [];
  const served = new Set<string>();
  const addVersion = (status: "draft" | "published"): PromptVersion => {
    const n = versions.length + 1;
    const v = { id: `v${n}`, promptId: prompt.id, version: n, content: `text ${n}`, variables: [], contentHash: `h${n}`, parentVersion: null, message: "", createdBy: ANA, createdAt: "t", status, origin: null, publishedAt: status === "published" ? "t" : null, source: null, includes: [] } as PromptVersion;
    versions.unshift(v);
    return v;
  };
  const repo = {
    environmentKeys: async () => ["dev", "pre", "pro"],
    get: async (id: string) => (id === prompt.id ? prompt : null),
    listVersions: async () => versions,
    getVersion: async (_p: string, n: number) => versions.find((v) => v.version === n) ?? null,
    addVersion: async (input: { content: string; status: "draft" | "published" }) => {
      const v = addVersion(input.status);
      v.content = input.content;
      return v;
    },
    publishVersion: async (_p: string, n: number) => {
      const v = versions.find((x) => x.version === n && x.status === "draft");
      if (!v) return null;
      v.status = "published";
      return v;
    },
    wasServed: async (_p: string, tag: string, version: number) => served.has(`${tag}:${version}`),
    moveTag: async (_p: string, tag: string, version: number | null, userId: string, reason: string, gate: GateRecord) => {
      if (version !== null) {
        tags.set(tag, version);
        served.add(`${tag}:${version}`);
      } else tags.delete(tag);
      const event = { id: `e${events.length}`, tag, fromVersion: null, toVersion: version, changedBy: userId, reason, createdAt: "t", gateVerdict: gate.verdict, gateBypassed: gate.bypassed, bypassReason: gate.bypassReason } as PromptTagEvent;
      events.push(event);
      return event;
    },
    listTags: async () => [],
    tagEvents: async () => [],
    listUsage: async () => [],
    getPolicy: async () => null,
  } as unknown as PromptRepository;
  return { repo, prompt, versions, tags, events, addVersion, served };
}

const allowGate: PromptGatePort = { check: async (_p, tag, version): Promise<PromptGateResult> => ({ allowed: true, verdict: "allowed", tag, version, requiredRuns: 1, runs: [], reason: "" }) };

function setup(gate: PromptGatePort = allowGate, now: () => Date = () => new Date("2026-10-10T00:00:00Z")) {
  const approvals = fakeApprovals();
  const prompts = fakePrompts();
  const identity = { getUsersByIds: async (ids: string[]) => ids.map((id) => ({ id, email: `${id}@x.io`, name: id })) } as never;
  const promptService = new PromptService(prompts.repo, gate, identity, new ApprovalRuleResolver(approvals.repo));
  const service = new ApprovalService(approvals.repo, promptService, prompts.repo, gate, identity, now);
  return { ...approvals, ...prompts, promptService, service };
}

const rule = (over: Partial<ApprovalRule> = {}): ApprovalRule => ({ action: "promote", stage: "pro", requirements: [{ role: "technical", min: 1 }], approvers: [], ...over });

describe("publishing needs approval", () => {
  it("a new version of a prompt with a publish rule is born as a draft and cannot be published directly", async () => {
    const t = setup();
    t.rules.set(`organization:${ORG}:publish:`, rule({ action: "publish", stage: "" }));
    const v = await t.promptService.saveVersion("p1", ZOE, { content: "hello" });
    expect(v.status).toBe("draft");
    await expect(t.promptService.publishDraft("p1", v.version)).rejects.toBeInstanceOf(ApprovalRequiredError);
  });

  it("an approved request publishes the draft by itself", async () => {
    const t = setup();
    t.rules.set(`organization:${ORG}:publish:`, rule({ action: "publish", stage: "" }));
    const v = await t.promptService.saveVersion("p1", ZOE, { content: "hello" });
    const opened = await t.service.open(t.prompt, ZOE, { action: "publish", version: v.version }, false);
    expect(opened.request.status).toBe("pending");
    const done = await t.service.decide(opened.request.id, ANA, { decision: "approve" });
    expect(done.request.status).toBe("executed");
    expect(t.versions[0]!.status).toBe("published");
  });

  it("business cannot approve a publication: that is a technical review", async () => {
    const t = setup();
    t.rules.set(`organization:${ORG}:publish:`, rule({ action: "publish", stage: "" }));
    const v = await t.promptService.saveVersion("p1", ZOE, { content: "hello" });
    const opened = await t.service.open(t.prompt, ZOE, { action: "publish", version: v.version }, false);
    await expect(t.service.decide(opened.request.id, CRIS, { decision: "approve" })).rejects.toBeInstanceOf(ApprovalNotAllowedError);
  });

  it("without a rule nothing changes: versions publish directly and a request is refused", async () => {
    const t = setup();
    const v = await t.promptService.saveVersion("p1", ZOE, { content: "hello" });
    expect(v.status).toBe("published");
    t.addVersion("draft");
    await expect(t.service.open(t.prompt, ZOE, { action: "publish", version: 2 }, false)).rejects.toBeInstanceOf(PromptInvariantError);
  });
});

describe("promotion per stage", () => {
  function withStages() {
    const t = setup();
    t.addVersion("published");
    // dev: un perfil técnico. pre y pro: técnico y de negocio.
    t.rules.set(`organization:${ORG}:promote:dev`, rule({ stage: "dev" }));
    t.rules.set(`organization:${ORG}:promote:pre`, rule({ stage: "pre", requirements: [{ role: "technical", min: 1 }, { role: "business", min: 1 }] }));
    t.rules.set(`organization:${ORG}:promote:pro`, rule({ stage: "pro", requirements: [{ role: "technical", min: 1 }, { role: "business", min: 1 }] }));
    return t;
  }

  it("each stage asks for what its own rule says", async () => {
    const t = withStages();
    const dev = await t.service.open(t.prompt, ZOE, { action: "promote", version: 1, tag: "dev" }, false);
    expect((await t.service.decide(dev.request.id, BEN, { decision: "approve" })).request.status).toBe("executed");
    expect(t.tags.get("dev")).toBe(1);

    const pro = await t.service.open(t.prompt, ZOE, { action: "promote", version: 1, tag: "pro" }, false);
    const afterTech = await t.service.decide(pro.request.id, ANA, { decision: "approve" });
    expect(afterTech.request.status).toBe("pending");
    expect(afterTech.evaluation.reason).toMatch(/business/);
    expect(t.tags.has("pro")).toBe(false);
    const afterBusiness = await t.service.decide(pro.request.id, CRIS, { decision: "approve" });
    expect(afterBusiness.request.status).toBe("executed");
    expect(t.tags.get("pro")).toBe(1);
    expect(t.events.at(-1)!.reason).toMatch(/Approved by/);
  });

  it("moving a protected tag directly is refused, naming the stage", async () => {
    const t = withStages();
    await expect(t.promptService.moveTag("p1", ZOE, { tag: "pro", version: 1 }, true)).rejects.toMatchObject({ approval: { action: "promote", stage: "pro" } });
  });

  it("a stage without a rule is not affected", async () => {
    const t = setup();
    t.addVersion("published");
    t.rules.set(`organization:${ORG}:promote:pro`, rule());
    await expect(t.promptService.moveTag("p1", ZOE, { tag: "pre", version: 1 }, true)).resolves.toBeDefined();
  });

  it("going back to a version the stage already served is a rollback and needs no approval", async () => {
    const t = withStages();
    t.served.add("pro:1");
    await expect(t.promptService.moveTag("p1", ZOE, { tag: "pro", version: 1 }, true)).resolves.toBeDefined();
    await expect(t.service.open(t.prompt, ZOE, { action: "promote", version: 1, tag: "pro" }, false)).rejects.toThrow(/rollback/);
  });

  it("one rejection closes the request", async () => {
    const t = withStages();
    const pro = await t.service.open(t.prompt, ZOE, { action: "promote", version: 1, tag: "pro" }, false);
    const out = await t.service.decide(pro.request.id, CRIS, { decision: "reject", comment: "not yet" });
    expect(out.request.status).toBe("rejected");
    await expect(t.service.decide(pro.request.id, ANA, { decision: "approve" })).rejects.toBeInstanceOf(PromptInvariantError);
    expect(t.tags.has("pro")).toBe(false);
  });

  it("the requester cannot approve their own request", async () => {
    const t = withStages();
    const pro = await t.service.open(t.prompt, ZOE, { action: "promote", version: 1, tag: "pro" }, false);
    await expect(t.service.decide(pro.request.id, ZOE, { decision: "approve" })).rejects.toBeInstanceOf(ApprovalNotAllowedError);
  });

  it("an approved request that the evaluation gate stops stays approved and can be retried", async () => {
    let open = false;
    const gate: PromptGatePort = {
      check: async (_p, tag, version): Promise<PromptGateResult> => ({ allowed: open, verdict: open ? "allowed" : "failed", tag, version, requiredRuns: 1, runs: [], reason: "evaluation failing" }),
    };
    const t = setup(gate);
    t.addVersion("published");
    t.rules.set(`organization:${ORG}:promote:pro`, rule());
    open = true; // al abrir, el gate deja
    const pro = await t.service.open(t.prompt, ZOE, { action: "promote", version: 1, tag: "pro" }, false);
    open = false; // al ejecutar, ya no
    const approved = await t.service.decide(pro.request.id, ANA, { decision: "approve" });
    expect(approved.request.status).toBe("approved");
    expect(approved.request.executionError).toMatch(/evaluation failing|Evaluation|failing/i);
    open = true;
    const retried = await t.service.execute(pro.request.id, ZOE);
    expect(retried.request.status).toBe("executed");
    expect(t.tags.get("pro")).toBe(1);
  });

  it("opening a request is refused while the evaluation gate would block it", async () => {
    const gate: PromptGatePort = { check: async (_p, tag, version): Promise<PromptGateResult> => ({ allowed: false, verdict: "no_evaluation", tag, version, requiredRuns: 1, runs: [], reason: "no evaluation" }) };
    const t = setup(gate);
    t.addVersion("published");
    t.rules.set(`organization:${ORG}:promote:pro`, rule());
    await expect(t.service.open(t.prompt, ZOE, { action: "promote", version: 1, tag: "pro" }, false)).rejects.toBeInstanceOf(PromptGateBlockedError);
  });
});

describe("default and extra approvers", () => {
  it("a default approver has to approve even when the minimum is already met", async () => {
    const t = setup();
    t.addVersion("published");
    t.rules.set(`organization:${ORG}:promote:pro`, rule({ approvers: [BEN] }));
    const pro = await t.service.open(t.prompt, ZOE, { action: "promote", version: 1, tag: "pro" }, false);
    expect((await t.service.decide(pro.request.id, ANA, { decision: "approve" })).request.status).toBe("pending");
    expect((await t.service.decide(pro.request.id, BEN, { decision: "approve" })).request.status).toBe("executed");
  });

  it("approvers added on the fly are required too", async () => {
    const t = setup();
    t.addVersion("published");
    t.rules.set(`organization:${ORG}:promote:pro`, rule());
    const pro = await t.service.open(t.prompt, ZOE, { action: "promote", version: 1, tag: "pro", extraApprovers: [CRIS] }, false);
    expect((await t.service.decide(pro.request.id, ANA, { decision: "approve" })).request.status).toBe("pending");
    expect((await t.service.decide(pro.request.id, CRIS, { decision: "approve" })).request.status).toBe("executed");
  });

  it("an approver can be added after the request was opened", async () => {
    const t = setup();
    t.addVersion("published");
    t.rules.set(`organization:${ORG}:promote:pro`, rule());
    const pro = await t.service.open(t.prompt, ZOE, { action: "promote", version: 1, tag: "pro" }, false);
    const out = await t.service.addApprover(pro.request.id, ZOE, CRIS);
    expect(out.request.extraApprovers).toEqual([CRIS]);
    expect((await t.service.decide(pro.request.id, ANA, { decision: "approve" })).request.status).toBe("pending");
  });

  it("refuses a request nobody could approve", async () => {
    const t = setup();
    t.addVersion("published");
    t.rules.set(`organization:${ORG}:promote:pro`, rule({ requirements: [{ role: "business", min: 2 }] }));
    await expect(t.service.open(t.prompt, ZOE, { action: "promote", version: 1, tag: "pro" }, false)).rejects.toThrow(/Nobody could approve/);
  });
});

describe("the organization sets the floor", () => {
  const scopeOrg: ApprovalScope = { type: "organization", id: ORG };
  const scopeExp: ApprovalScope = { type: "experiment", id: AGENT };

  it("an experiment cannot ask for less than its organization", async () => {
    const t = setup();
    await t.service.setRule(scopeOrg, ORG, ANA, { action: "promote", stage: "pro", requirements: [{ role: "technical", min: 2 }], approvers: [ANA] });
    await expect(t.service.setRule(scopeExp, ORG, ANA, { action: "promote", stage: "pro", requirements: [{ role: "technical", min: 1 }], approvers: [ANA] })).rejects.toBeInstanceOf(ValidationError);
    await expect(t.service.setRule(scopeExp, ORG, ANA, { action: "promote", stage: "pro", requirements: [{ role: "technical", min: 2 }], approvers: [] })).rejects.toBeInstanceOf(ValidationError);
  });

  it("an experiment can tighten it, and the prompt gets the stricter of both", async () => {
    const t = setup();
    await t.service.setRule(scopeOrg, ORG, ANA, { action: "promote", stage: "pro", requirements: [{ role: "technical", min: 1 }] });
    await t.service.setRule(scopeExp, ORG, ANA, { action: "promote", stage: "pro", requirements: [{ role: "technical", min: 2 }, { role: "business", min: 1 }] });
    const effective = (await t.service.effectiveRules(t.prompt)).find((r) => r.stage === "pro")!;
    expect(effective.requirements).toEqual(expect.arrayContaining([{ role: "technical", min: 2 }, { role: "business", min: 1 }]));
  });

  it("an experiment can add a rule where the organization has none", async () => {
    const t = setup();
    await expect(t.service.setRule(scopeExp, ORG, ANA, { action: "promote", stage: "pre", requirements: [{ role: "business", min: 1 }] })).resolves.toBeDefined();
  });

  it("every rule applies to a prompt shared by several agents", async () => {
    const t = setup();
    await t.service.setRule({ type: "experiment", id: OTHER_AGENT }, ORG, ANA, { action: "promote", stage: "pro", requirements: [{ role: "business", min: 1 }] });
    expect((await t.promptService.detail("p1")).approvals.promote).toEqual(["pro"]);
  });

  it("rules are validated: publishing is technical only, stages are the organization's, approvers must be able to approve", async () => {
    const t = setup();
    await expect(t.service.setRule(scopeOrg, ORG, ANA, { action: "publish", requirements: [{ role: "business", min: 1 }] })).rejects.toBeInstanceOf(ValidationError);
    await expect(t.service.setRule(scopeOrg, ORG, ANA, { action: "promote", stage: "qa", requirements: [{ role: "technical", min: 1 }] })).rejects.toBeInstanceOf(ValidationError);
    await expect(t.service.setRule(scopeOrg, ORG, ANA, { action: "promote", stage: "pro", approvers: ["ghost"] })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("lifecycle", () => {
  it("a live request expires after its date", async () => {
    let now = new Date("2026-10-10T00:00:00Z");
    const t = setup(allowGate, () => now);
    t.addVersion("published");
    t.rules.set(`organization:${ORG}:promote:pro`, rule());
    const pro = await t.service.open(t.prompt, ZOE, { action: "promote", version: 1, tag: "pro" }, false);
    now = new Date("2026-10-20T00:00:00Z");
    await expect(t.service.decide(pro.request.id, ANA, { decision: "approve" })).rejects.toThrow(/expired/);
  });

  it("only the requester cancels, and a second identical request is refused while one is open", async () => {
    const t = setup();
    t.addVersion("published");
    t.rules.set(`organization:${ORG}:promote:pro`, rule());
    const pro = await t.service.open(t.prompt, ZOE, { action: "promote", version: 1, tag: "pro" }, false);
    await expect(t.service.open(t.prompt, ZOE, { action: "promote", version: 1, tag: "pro" }, false)).rejects.toThrow(/already an open request/);
    await expect(t.service.cancel(pro.request.id, ANA)).rejects.toBeInstanceOf(ApprovalNotAllowedError);
    expect((await t.service.cancel(pro.request.id, ZOE)).request.status).toBe("cancelled");
  });

  it("the inbox lists what the person can still decide", async () => {
    const t = setup();
    t.addVersion("published");
    t.rules.set(`organization:${ORG}:promote:pro`, rule({ requirements: [{ role: "business", min: 1 }] }));
    const pro = await t.service.open(t.prompt, ZOE, { action: "promote", version: 1, tag: "pro" }, false);
    expect((await t.service.inbox(ORG, CRIS)).map((v) => v.request.id)).toEqual([pro.request.id]);
    expect(await t.service.inbox(ORG, ANA)).toEqual([]); // no tiene el perfil que pide la regla
    expect(await t.service.inbox(ORG, ZOE)).toEqual([]); // la pidió ella
  });

  it("two approvals arriving at the same time carry the action out once and keep it executed", async () => {
    const t = setup();
    t.addVersion("published");
    t.rules.set(`organization:${ORG}:promote:pro`, rule({ requirements: [{ role: "technical", min: 1 }] }));
    const pro = await t.service.open(t.prompt, ZOE, { action: "promote", version: 1, tag: "pro" }, false);
    await Promise.allSettled([t.service.decide(pro.request.id, ANA, { decision: "approve" }), t.service.decide(pro.request.id, BEN, { decision: "approve" })]);
    const final = t.requests.get(pro.request.id)!;
    expect(final.status).toBe("executed");
    expect(final.executionError).toBeNull();
    expect(t.events.filter((e) => e.tag === "pro")).toHaveLength(1);
  });

  it("a pending request whose rule was removed no longer waits for anyone and can be carried out by the requester", async () => {
    const t = setup();
    t.addVersion("published");
    t.rules.set(`organization:${ORG}:promote:pro`, rule());
    const pro = await t.service.open(t.prompt, ZOE, { action: "promote", version: 1, tag: "pro" }, false);
    t.rules.delete(`organization:${ORG}:promote:pro`);
    expect((await t.service.execute(pro.request.id, ZOE)).request.status).toBe("executed");
    expect(t.tags.get("pro")).toBe(1);
  });

  it("tightening the rule after approval sends an unexecuted request back to pending", async () => {
    const gateOpen = { open: false };
    const gate: PromptGatePort = {
      check: async (_p, tag, version): Promise<PromptGateResult> => ({ allowed: gateOpen.open, verdict: "failed", tag, version, requiredRuns: 1, runs: [], reason: "blocked" }),
    };
    const t = setup(gate);
    t.addVersion("published");
    t.rules.set(`organization:${ORG}:promote:pro`, rule());
    gateOpen.open = true;
    const pro = await t.service.open(t.prompt, ZOE, { action: "promote", version: 1, tag: "pro" }, false);
    gateOpen.open = false;
    await t.service.decide(pro.request.id, ANA, { decision: "approve" }); // aprobada, no ejecutada
    t.rules.set(`organization:${ORG}:promote:pro`, rule({ requirements: [{ role: "technical", min: 1 }, { role: "business", min: 1 }] }));
    gateOpen.open = true;
    await expect(t.service.execute(pro.request.id, ZOE)).rejects.toThrow(/needs more approvals/);
    expect(t.requests.get(pro.request.id)!.status).toBe("pending");
  });
});
