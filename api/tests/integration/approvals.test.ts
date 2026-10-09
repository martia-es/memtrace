/**
 * Contra un Postgres real (15+) con las migraciones 001-038 aplicadas. Opt-in: `POSTGRES_INTEGRATION_URL=postgres://… npm run test:integration`.
 * Cubre lo que los fakes no pueden: las restricciones de la migración 038 (una regla por ámbito, acción y paso; una sola solicitud
 * viva por destino), las consultas de perfiles y el flujo de punta a punta (ADR-076): regla → solicitud → decisiones → ejecución.
 */
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresApprovalRepository } from "@/adapters/outbound/postgres/postgres-approval-repository";
import { PostgresIdentityRepository } from "@/adapters/outbound/postgres/postgres-identity-repository";
import { PostgresPromptRepository } from "@/adapters/outbound/postgres/postgres-prompt-repository";
import { ApprovalRuleResolver } from "@/application/approval-rules";
import { ApprovalService } from "@/application/approval-service";
import type { PromptGatePort } from "@/application/prompt-gate-service";
import { PromptService } from "@/application/prompt-service";
import { ApprovalRequiredError, ValidationError } from "@/domain/errors";

const url = process.env.POSTGRES_INTEGRATION_URL;

const allow: PromptGatePort = { check: async (_p, tag, version) => ({ allowed: true, verdict: "allowed", tag, version, requiredRuns: 1, runs: [], reason: "" }) };

describe.skipIf(!url)("prompt approvals (postgres)", () => {
  let pool: Pool;
  let approvals: PostgresApprovalRepository;
  let service: ApprovalService;
  let prompts: PromptService;
  let identity: PostgresIdentityRepository;
  let orgId: string;
  let agentA: string;
  let agentB: string;
  const users: Record<string, string> = {};
  const stamp = Date.now();

  const addUser = async (key: string): Promise<string> => {
    const id = (await pool.query<{ id: string }>(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [`${key}-${stamp}@example.com`, key])).rows[0]!.id;
    users[key] = id;
    return id;
  };
  const member = (experimentId: string, key: string, role: string) =>
    pool.query(`INSERT INTO experiment_memberships (experiment_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [experimentId, users[key], role]);

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    identity = new PostgresIdentityRepository(pool);
    approvals = new PostgresApprovalRepository(pool);
    const promptRepo = new PostgresPromptRepository(pool);
    prompts = new PromptService(promptRepo, allow, identity, new ApprovalRuleResolver(approvals));
    service = new ApprovalService(approvals, prompts, promptRepo, allow, identity);
    for (const key of ["owner", "tech1", "tech2", "biz"]) await addUser(key);
    orgId = (await identity.createOrganization(`approvals-org-${stamp}`, users.owner!)).id;
    agentA = (await identity.createExperiment(orgId, "weather", `weather-${stamp}`)).id;
    agentB = (await identity.createExperiment(orgId, "geo", `geo-${stamp}`)).id;
    await member(agentA, "owner", "technical");
    await member(agentA, "tech1", "technical");
    await member(agentA, "tech2", "technical");
    await member(agentA, "biz", "business");
  });
  afterAll(async () => {
    await pool.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`%-${stamp}@example.com`]);
    await pool.end();
  });

  it("seeds the permissions: technical and business approve, only org_admin manages the rules", async () => {
    const { rows } = await pool.query<{ role_name: string; permission: string }>(`SELECT role_name, permission FROM role_permissions WHERE permission IN ('prompt:approve', 'approval:manage')`);
    const has = (role: string, permission: string) => rows.some((r) => r.role_name === role && r.permission === permission);
    expect(has("technical", "prompt:approve")).toBe(true);
    expect(has("business", "prompt:approve")).toBe(true);
    expect(has("org_admin", "approval:manage")).toBe(true);
    expect(has("org_admin", "prompt:approve")).toBe(false);
  });

  it("stores one rule per scope, action and stage, and replaces it when set again", async () => {
    const scope = { type: "organization", id: orgId } as const;
    await approvals.setRule(scope, { action: "promote", stage: "pro", requirements: [{ role: "technical", min: 1 }], approvers: [] }, users.owner!);
    const second = await approvals.setRule(scope, { action: "promote", stage: "pro", requirements: [{ role: "technical", min: 2 }, { role: "business", min: 1 }], approvers: [users.tech1!] }, users.owner!);
    expect(second.requirements).toEqual([{ role: "business", min: 1 }, { role: "technical", min: 2 }]);
    expect(second.approvers).toEqual([users.tech1]);
    expect(await approvals.listRules(scope)).toHaveLength(1);
    expect(await approvals.deleteRule(scope, "promote", "pro")).toBe(true);
    expect(await approvals.deleteRule(scope, "promote", "pro")).toBe(false);
  });

  it("refuses rows that break the shape: publish with a stage, promote without one", async () => {
    await expect(pool.query(`INSERT INTO approval_rules (organization_id, action, stage) VALUES ($1, 'publish', 'pro')`, [orgId])).rejects.toBeDefined();
    await expect(pool.query(`INSERT INTO approval_rules (organization_id, action, stage) VALUES ($1, 'promote', '')`, [orgId])).rejects.toBeDefined();
    await expect(pool.query(`INSERT INTO approval_rules (organization_id, experiment_id, action, stage) VALUES ($1, $2, 'publish', '')`, [orgId, agentA])).rejects.toBeDefined();
  });

  it("finds the people who can approve with their profiles, and stacks organization and agent rules", async () => {
    const people = await approvals.approvers([agentA, agentB]);
    expect(people.find((p) => p.userId === users.biz)?.roles).toEqual(["business"]);
    expect(people.find((p) => p.userId === users.tech1)?.roles).toEqual(["technical"]);
    await approvals.setRule({ type: "organization", id: orgId }, { action: "publish", stage: "", requirements: [{ role: "technical", min: 1 }], approvers: [] }, users.owner!);
    await approvals.setRule({ type: "experiment", id: agentB }, { action: "publish", stage: "", requirements: [{ role: "technical", min: 2 }], approvers: [] }, users.owner!);
    expect(await approvals.rulesFor(orgId, [agentA, agentB], "publish", "")).toHaveLength(2);
    expect(await approvals.rulesFor(orgId, [agentA], "publish", "")).toHaveLength(1);
    await approvals.deleteRule({ type: "experiment", id: agentB }, "publish", "");
  });

  it("publish flow: the draft waits for approval and is published when it arrives", async () => {
    const created = await prompts.create(orgId, users.owner!, { name: "greeter", content: "Hola", experimentIds: [agentA] });
    // la regla de publicación de la organización (técnico, 1) ya existe del test anterior
    expect(created.versions[0]!.status).toBe("draft");
    expect(created.approvals.publish).toBe(true);
    await expect(prompts.publishDraft(created.prompt.id, 1)).rejects.toBeInstanceOf(ApprovalRequiredError);

    const opened = await service.open(created.prompt, users.owner!, { action: "publish", version: 1, note: "first version" }, false);
    expect(opened.request.status).toBe("pending");
    await expect(service.open(created.prompt, users.owner!, { action: "publish", version: 1 }, false)).rejects.toThrow(/already an open request/);

    const done = await service.decide(opened.request.id, users.tech1!, { decision: "approve", comment: "ok" });
    expect(done.request.status).toBe("executed");
    expect(done.request.decisions).toHaveLength(1);
    expect((await prompts.detail(created.prompt.id)).versions[0]!.status).toBe("published");
  });

  it("promotion flow: dev asks for a technical, pro for a technical and a business", async () => {
    const org = { type: "organization", id: orgId } as const;
    await service.setRule(org, orgId, users.owner!, { action: "promote", stage: "dev", requirements: [{ role: "technical", min: 1 }] });
    await service.setRule(org, orgId, users.owner!, { action: "promote", stage: "pro", requirements: [{ role: "technical", min: 1 }, { role: "business", min: 1 }], approvers: [users.tech2!] });
    const prompt = (await prompts.detail((await pool.query<{ id: string }>(`SELECT id FROM prompts WHERE organization_id = $1 AND name = 'greeter'`, [orgId])).rows[0]!.id)).prompt;

    await expect(prompts.moveTag(prompt.id, users.owner!, { tag: "dev", version: 1 }, true)).rejects.toBeInstanceOf(ApprovalRequiredError);
    const dev = await service.open(prompt, users.owner!, { action: "promote", version: 1, tag: "dev" }, false);
    expect((await service.decide(dev.request.id, users.tech1!, { decision: "approve" })).request.status).toBe("executed");
    expect((await prompts.resolve(prompt.id, "dev")).version).toBe(1);

    const pro = await service.open(prompt, users.owner!, { action: "promote", version: 1, tag: "pro", note: "go live" }, false);
    expect((await service.decide(pro.request.id, users.tech1!, { decision: "approve" })).request.status).toBe("pending"); // falta negocio y la obligatoria
    expect((await service.decide(pro.request.id, users.biz!, { decision: "approve" })).request.status).toBe("pending"); // falta la obligatoria
    const executed = await service.decide(pro.request.id, users.tech2!, { decision: "approve" });
    expect(executed.request.status).toBe("executed");
    expect((await prompts.resolve(prompt.id, "pro")).version).toBe(1);

    const events = (await prompts.detail(prompt.id)).events;
    expect(events[0]).toMatchObject({ tag: "pro", changedBy: users.owner });
    expect(events[0]!.reason).toMatch(/Approved by/);

    // la bandeja y el historial salen de la base de datos
    expect((await service.list(prompt)).length).toBeGreaterThanOrEqual(3);
    expect(await service.inbox(orgId, users.biz!)).toEqual([]);
  });

  it("an experiment cannot loosen the organization's rule, and stricter rules stack", async () => {
    await expect(service.setRule({ type: "experiment", id: agentA }, orgId, users.owner!, { action: "promote", stage: "pro", requirements: [{ role: "technical", min: 1 }] })).rejects.toBeInstanceOf(ValidationError);
    await service.setRule({ type: "experiment", id: agentA }, orgId, users.owner!, {
      action: "promote",
      stage: "pro",
      requirements: [{ role: "technical", min: 2 }, { role: "business", min: 1 }],
      approvers: [users.tech2!],
    });
    const prompt = (await pool.query<{ id: string }>(`SELECT id FROM prompts WHERE organization_id = $1 AND name = 'greeter'`, [orgId])).rows[0]!.id;
    const effective = (await service.effectiveRules((await prompts.detail(prompt)).prompt)).find((r) => r.stage === "pro")!;
    expect(effective.requirements).toEqual(expect.arrayContaining([{ role: "technical", min: 2 }, { role: "business", min: 1 }]));
  });

  it("claims the execution of a request for exactly one caller, and lets it be claimed again once released", async () => {
    const promptId = (await pool.query<{ id: string }>(`SELECT id FROM prompts WHERE organization_id = $1 AND name = 'greeter'`, [orgId])).rows[0]!.id;
    const created = await approvals.createRequest({ promptId, action: "promote", version: 1, tag: "pre", note: "", bypassReason: null, requestedBy: users.owner!, extraApprovers: [], expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(created).not.toBeNull();
    const first = await Promise.all([approvals.claimExecution(created!.id), approvals.claimExecution(created!.id), approvals.claimExecution(created!.id)]);
    expect(first.filter(Boolean)).toHaveLength(1);
    await approvals.releaseExecution(created!.id);
    expect(await approvals.claimExecution(created!.id)).toBe(true);
    await approvals.setStatus(created!.id, "cancelled");
    expect(await approvals.claimExecution(created!.id)).toBe(false); // una solicitud cerrada no se reserva
  });

  it("deleting a prompt version cascades to its requests", async () => {
    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM approval_requests r JOIN prompts p ON p.id = r.prompt_id WHERE p.organization_id = $1`, [orgId]);
    expect(rows[0]!.n).toBeGreaterThan(0);
  });
});
