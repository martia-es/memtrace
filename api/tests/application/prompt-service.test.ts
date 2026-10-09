import { describe, expect, it } from "vitest";
import { PromptPlaygroundService } from "@/application/prompt-playground-service";
import { PromptService, hashOverrideToken } from "@/application/prompt-service";
import { PromptMapService } from "@/application/prompt-map-service";
import type { IdentityRepository } from "@/application/ports/identity-repository";
import { promotionImpact } from "@/domain/prompt-map";
import type { PromptRepository } from "@/application/ports/prompt-repository";
import { AssistantNotFoundError, PromptGateBlockedError, PromptInvariantError, PromptNotFoundError, PromptPromoteForbiddenError, ValidationError } from "@/domain/errors";
import { PROMPT_OVERRIDE_HEADER } from "@/domain/prompt";
import type { GateRecord, NewPrompt, NewPromptVersion, Prompt, PromptSummary, PromptTag, PromptTagEvent, PromptUsage, PromptVersion, UsageItem } from "@/domain/prompt";
import type { PromptGateResult, PromptPolicy } from "@/domain/prompt-gate";

const ORG = "org-1";
const USER = "user-1";
const AGENT_A = "agent-a";
const AGENT_B = "agent-b";
const FOREIGN = "agent-foreign";

/** Repositorio en memoria con las mismas reglas que el de Postgres (numeración, tags, historial). */
function fakeRepo() {
  const prompts = new Map<string, Prompt>();
  const versions = new Map<string, PromptVersion[]>();
  const tags = new Map<string, Map<string, number>>();
  const events = new Map<string, PromptTagEvent[]>();
  const usage: Array<UsageItem & { experimentId: string; environment: string }> = [];
  const policies = new Map<string, PromptPolicy>();
  const counters = new Map<string, number>();
  const overrides = new Map<string, { experimentId: string; promptId: string; version: number; expired: boolean; uses: number }>();
  let seq = 0;

  const repo: PromptRepository = {
    environmentKeys: async () => ["dev", "pre", "pro"],
    experimentsInOrganization: async (_org, ids) => ids.filter((id) => id !== FOREIGN),
    create: async (input: NewPrompt, first: Omit<NewPromptVersion, "promptId">) => {
      if ([...prompts.values()].some((p) => p.name === input.name)) throw new PromptInvariantError(`A prompt named "${input.name}" already exists in this organization`);
      const id = `p${++seq}`;
      const prompt: Prompt = { id, organizationId: input.organizationId, kind: input.kind, name: input.name, description: input.description, archivedAt: null, createdBy: input.createdBy, createdAt: "t", updatedAt: "t", experimentIds: input.experimentIds };
      prompts.set(id, prompt);
      versions.set(id, []);
      tags.set(id, new Map());
      events.set(id, []);
      const version = await repo.addVersion({ ...first, promptId: id });
      return { prompt, version };
    },
    get: async (id) => prompts.get(id) ?? null,
    findByName: async (_org, name) => [...prompts.values()].find((p) => p.name === name) ?? null,
    list: async (_org, filter) => {
      const out: PromptSummary[] = [];
      for (const p of prompts.values()) {
        if (!filter.includeArchived && p.archivedAt) continue;
        if (filter.experimentId && !p.experimentIds.includes(filter.experimentId)) continue;
        out.push({ ...p, latestVersion: Math.max(0, ...versions.get(p.id)!.filter((v) => v.status === "published").map((v) => v.version)), tags: Object.fromEntries(tags.get(p.id)!) });
      }
      return out;
    },
    update: async (id, patch) => {
      const p = prompts.get(id);
      if (!p) return null;
      const next = { ...p, description: patch.description ?? p.description, archivedAt: patch.archived === undefined ? p.archivedAt : patch.archived ? "now" : null };
      prompts.set(id, next);
      return next;
    },
    setAgents: async (id, ids) => {
      prompts.set(id, { ...prompts.get(id)!, experimentIds: ids });
    },
    addVersion: async (input) => {
      const list = versions.get(input.promptId)!;
      // como la base de datos: el contador nunca retrocede, aunque se descarte un borrador
      const number = (counters.get(input.promptId) ?? 0) + 1;
      counters.set(input.promptId, number);
      const version: PromptVersion = {
        id: `v${++seq}`, promptId: input.promptId, version: number, content: input.content, variables: input.variables, contentHash: input.contentHash,
        parentVersion: input.parentVersion, message: input.message, createdBy: input.createdBy, createdAt: "t",
        status: input.status, origin: input.origin, publishedAt: input.status === "published" ? "t" : null,
        source: input.source, includes: input.includes,
      };
      list.push(version);
      return version;
    },
    usedBy: async (_org, fragmentName) =>
      [...prompts.values()]
        .filter((p) => !p.archivedAt)
        .flatMap((p) => {
          const latest = (versions.get(p.id) ?? []).filter((v) => v.status === "published").sort((a, b) => b.version - a.version)[0];
          return latest && latest.includes.some((i) => i.name === fragmentName) ? [{ promptId: p.id, name: p.name, version: latest.version, includes: latest.includes }] : [];
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    publishVersion: async (id, n) => {
      const found = versions.get(id)?.find((v) => v.version === n);
      if (!found || found.status !== "draft") return null;
      found.status = "published";
      found.publishedAt = "t";
      return found;
    },
    deleteDraft: async (id, n) => {
      const list = versions.get(id) ?? [];
      const at = list.findIndex((v) => v.version === n && v.status === "draft");
      if (at < 0) return false;
      list.splice(at, 1);
      return true;
    },
    listVersions: async (id) => [...(versions.get(id) ?? [])].reverse(),
    getVersion: async (id, n) => versions.get(id)?.find((v) => v.version === n) ?? null,
    getVersionByTag: async (id, tag) => {
      const n = tags.get(id)?.get(tag);
      return n === undefined ? null : (versions.get(id)!.find((v) => v.version === n) ?? null);
    },
    listTags: async (id): Promise<PromptTag[]> => [...(tags.get(id) ?? [])].map(([tag, version]) => ({ tag, version, updatedBy: USER, updatedAt: "t" })),
    moveTag: async (id, tag, version, userId, reason, gate: GateRecord) => {
      if (version !== null && !versions.get(id)!.some((v) => v.version === version)) return null;
      const from = tags.get(id)!.get(tag) ?? null;
      if (version === null) tags.get(id)!.delete(tag);
      else tags.get(id)!.set(tag, version);
      const event: PromptTagEvent = {
        id: `e${++seq}`, tag, fromVersion: from, toVersion: version, changedBy: userId, reason, createdAt: "t",
        gateVerdict: gate.verdict, gateBypassed: gate.bypassed, bypassReason: gate.bypassReason,
      };
      events.get(id)!.unshift(event);
      return event;
    },
    tagEvents: async (id) => events.get(id) ?? [],
    wasServed: async (id, tag, version) => (events.get(id) ?? []).some((e) => e.tag === tag && e.toVersion === version && !e.gateBypassed),
    createOverride: async (input) => {
      overrides.set(input.tokenHash, { experimentId: input.experimentId, promptId: input.promptId, version: input.version, expired: input.ttlSeconds <= 0, uses: 0 });
    },
    consumeOverride: async (tokenHash, experimentId) => {
      const found = overrides.get(tokenHash);
      if (!found || found.expired || found.experimentId !== experimentId) return null;
      found.uses += 1;
      return { promptId: found.promptId, version: found.version };
    },
    overrideUses: async (tokenHash) => overrides.get(tokenHash)?.uses ?? 0,
    getPolicy: async (id) => policies.get(id) ?? null,
    setPolicy: async (id, policy, userId) => {
      const saved: PromptPolicy = { promptId: id, datasetId: policy.datasetId, requiredRuns: policy.requiredRuns, updatedBy: userId, updatedAt: "t" };
      policies.set(id, saved);
      return saved;
    },
    deletePolicy: async (id) => {
      policies.delete(id);
    },
    recordUsage: async (experimentId, environment, items) => {
      for (const item of items) usage.push({ ...item, experimentId, environment });
    },
    listUsage: async (id): Promise<PromptUsage[]> =>
      usage.filter((u) => u.promptId === id).map((u) => ({ experimentId: u.experimentId, environment: u.environment, tag: u.tag, version: u.version, firstSeenAt: "t", lastSeenAt: "t" })),
  };
  return Object.assign(repo, { __overrides: overrides });
}

async function seeded() {
  const service = new PromptService(fakeRepo());
  const detail = await service.create(ORG, USER, { name: "weather-system", content: "Eres un asistente del tiempo para {{ciudad}}.", experimentIds: [AGENT_A] });
  return { service, id: detail.prompt.id };
}

describe("PromptService (ADR-067)", () => {
  it("creates the prompt with its version 1 and detects the variables", async () => {
    const { service, id } = await seeded();
    const detail = await service.detail(id);
    expect(detail.versions).toHaveLength(1);
    expect(detail.versions[0]).toMatchObject({ version: 1, parentVersion: null, variables: ["ciudad"] });
    expect(detail.prompt.experimentIds).toEqual([AGENT_A]);
  });

  it("a prompt can belong to several agents, and the list filters by agent", async () => {
    const { service, id } = await seeded();
    await service.update(id, { experimentIds: [AGENT_A, AGENT_B] });
    expect((await service.list(ORG, { experimentId: AGENT_B })).map((p) => p.id)).toEqual([id]);
    expect(await service.list(ORG, { experimentId: "other" })).toEqual([]);
  });

  it("rejects agents from another organization", async () => {
    const { service, id } = await seeded();
    await expect(service.update(id, { experimentIds: [AGENT_A, FOREIGN] })).rejects.toBeInstanceOf(PromptInvariantError);
    await expect(service.create(ORG, USER, { name: "x", content: "hi", experimentIds: [FOREIGN] })).rejects.toBeInstanceOf(PromptInvariantError);
  });

  it("refuses a repeated name", async () => {
    const { service } = await seeded();
    await expect(service.create(ORG, USER, { name: "weather-system", content: "otra cosa" })).rejects.toBeInstanceOf(PromptInvariantError);
  });

  it("every save is a new immutable version whose parent is the previous one", async () => {
    const { service, id } = await seeded();
    const v2 = await service.saveVersion(id, USER, { content: "Eres breve.", message: "shorter" });
    expect(v2).toMatchObject({ version: 2, parentVersion: 1, message: "shorter" });
    const v3 = await service.saveVersion(id, USER, { content: "Eres breve y amable.", parentVersion: 1 });
    expect(v3.parentVersion).toBe(1);
  });

  it("does not create a version when the text did not change", async () => {
    const { service, id } = await seeded();
    await expect(service.saveVersion(id, USER, { content: "Eres un asistente del tiempo para {{ciudad}}." })).rejects.toThrow(/identical to version 1/);
  });

  it("rejects an unknown parent version", async () => {
    const { service, id } = await seeded();
    await expect(service.saveVersion(id, USER, { content: "otro", parentVersion: 9 })).rejects.toBeInstanceOf(ValidationError);
  });

  it("environment tags need promote permission; free tags do not", async () => {
    const { service, id } = await seeded();
    await expect(service.moveTag(id, USER, { tag: "pro", version: 1 }, false)).rejects.toBeInstanceOf(PromptPromoteForbiddenError);
    await expect(service.moveTag(id, USER, { tag: "stable", version: 1 }, false)).resolves.toMatchObject({ tag: "stable", toVersion: 1 });
    await expect(service.moveTag(id, USER, { tag: "pro", version: 1 }, true)).resolves.toMatchObject({ tag: "pro", fromVersion: null, toVersion: 1 });
  });

  it("moving a tag records from/to in the history and the tag resolves to the new version", async () => {
    const { service, id } = await seeded();
    await service.saveVersion(id, USER, { content: "Versión dos." });
    await service.moveTag(id, USER, { tag: "dev", version: 1 }, true);
    await service.moveTag(id, USER, { tag: "dev", version: 2, reason: "tone fix" }, true);
    expect((await service.resolve(id, "dev")).version).toBe(2);
    const { events } = await service.detail(id);
    expect(events[0]).toMatchObject({ tag: "dev", fromVersion: 1, toVersion: 2, reason: "tone fix" });
  });

  it("removing a tag leaves an event and the tag stops resolving", async () => {
    const { service, id } = await seeded();
    await service.moveTag(id, USER, { tag: "dev", version: 1 }, true);
    await service.moveTag(id, USER, { tag: "dev", version: null }, true);
    await expect(service.resolve(id, "dev")).rejects.toBeInstanceOf(PromptNotFoundError);
    expect((await service.detail(id)).events[0]).toMatchObject({ tag: "dev", fromVersion: 1, toVersion: null });
  });

  it("resolves by version number or by tag, and 404s on unknowns", async () => {
    const { service, id } = await seeded();
    await service.moveTag(id, USER, { tag: "pre", version: 1 }, true);
    expect((await service.resolve(id, "1")).version).toBe(1);
    expect((await service.resolve(id, "pre")).version).toBe(1);
    await expect(service.resolve(id, "7")).rejects.toBeInstanceOf(PromptNotFoundError);
    await expect(service.moveTag(id, USER, { tag: "stable", version: 7 }, true)).rejects.toBeInstanceOf(PromptNotFoundError);
  });

  it("archiving keeps the history, hides the prompt from the list and blocks new versions and tag moves", async () => {
    const { service, id } = await seeded();
    await service.moveTag(id, USER, { tag: "dev", version: 1 }, true);
    await service.update(id, { archived: true });
    expect(await service.list(ORG)).toEqual([]);
    expect(await service.list(ORG, { includeArchived: true })).toHaveLength(1);
    expect((await service.detail(id)).versions).toHaveLength(1);
    await expect(service.saveVersion(id, USER, { content: "nueva" })).rejects.toBeInstanceOf(PromptInvariantError);
    await expect(service.moveTag(id, USER, { tag: "dev", version: 1 }, true)).rejects.toBeInstanceOf(PromptInvariantError);
    await service.update(id, { archived: false });
    await expect(service.saveVersion(id, USER, { content: "nueva" })).resolves.toMatchObject({ version: 2 });
  });

  it("unknown prompt -> not found", async () => {
    const { service } = await seeded();
    await expect(service.detail("nope")).rejects.toBeInstanceOf(PromptNotFoundError);
  });

  describe("what the SDK asks for (ADR-068)", () => {
    it("resolves by tag or by version for an agent the prompt belongs to", async () => {
      const { service, id } = await seeded();
      await service.saveVersion(id, USER, { content: "Versión dos." });
      await service.moveTag(id, USER, { tag: "dev", version: 2 }, true);
      const byTag = await service.resolveForAgent(AGENT_A, ORG, "weather-system", { tag: "dev" });
      expect(byTag.version.version).toBe(2);
      expect(byTag.tag).toBe("dev");
      const pinned = await service.resolveForAgent(AGENT_A, ORG, "weather-system", { version: 1 });
      expect(pinned).toMatchObject({ tag: null, version: { version: 1 } });
    });

    it("does not serve a prompt to an agent it does not belong to", async () => {
      const { service, id } = await seeded();
      await service.moveTag(id, USER, { tag: "dev", version: 1 }, true);
      await expect(service.resolveForAgent(AGENT_B, ORG, "weather-system", { tag: "dev" })).rejects.toBeInstanceOf(PromptNotFoundError);
      await expect(service.resolveForAgent(AGENT_A, ORG, "does-not-exist", { tag: "dev" })).rejects.toBeInstanceOf(PromptNotFoundError);
    });

    it("404s on a tag that points nowhere and on a version that does not exist, and wants exactly one of tag or version", async () => {
      const { service } = await seeded();
      await expect(service.resolveForAgent(AGENT_A, ORG, "weather-system", { tag: "pro" })).rejects.toBeInstanceOf(PromptNotFoundError);
      await expect(service.resolveForAgent(AGENT_A, ORG, "weather-system", { version: 9 })).rejects.toBeInstanceOf(PromptNotFoundError);
      await expect(service.resolveForAgent(AGENT_A, ORG, "weather-system", {})).rejects.toBeInstanceOf(ValidationError);
      await expect(service.resolveForAgent(AGENT_A, ORG, "weather-system", { tag: "dev", version: 1 })).rejects.toBeInstanceOf(ValidationError);
    });

    it("keeps serving an archived prompt: archiving must not break the agents that already use it", async () => {
      const { service, id } = await seeded();
      await service.moveTag(id, USER, { tag: "pro", version: 1 }, true);
      await service.update(id, { archived: true });
      await expect(service.resolveForAgent(AGENT_A, ORG, "weather-system", { tag: "pro" })).resolves.toMatchObject({ prompt: { archivedAt: expect.any(String) } });
    });

    it("records what the agent reports and shows it in the detail, ignoring what does not fit", async () => {
      const { service, id } = await seeded();
      const recorded = await service.recordUsage(AGENT_A, ORG, "pro", [
        { name: "weather-system", tag: "pro", version: 1 },
        { name: "weather-system", tag: null, version: 9 }, // versión que no existe
        { name: "unknown", tag: "pro", version: 1 }, // prompt que no existe
      ]);
      expect(recorded).toBe(1);
      const { usage } = await service.detail(id);
      expect(usage).toEqual([expect.objectContaining({ experimentId: AGENT_A, environment: "pro", tag: "pro", version: 1 })]);
    });

    it("ignores a report from an agent the prompt does not belong to", async () => {
      const { service } = await seeded();
      expect(await service.recordUsage(AGENT_B, ORG, "dev", [{ name: "weather-system", tag: "dev", version: 1 }])).toBe(0);
    });

    it("rejects an invalid environment and oversized reports", async () => {
      const { service } = await seeded();
      await expect(service.recordUsage(AGENT_A, ORG, "PRO env", [])).rejects.toBeInstanceOf(ValidationError);
      const many = Array.from({ length: 51 }, () => ({ name: "weather-system", tag: null, version: 1 }));
      await expect(service.recordUsage(AGENT_A, ORG, "pro", many)).rejects.toBeInstanceOf(ValidationError);
    });

    it("accepts an agent that does not declare an environment", async () => {
      const { service, id } = await seeded();
      await service.recordUsage(AGENT_A, ORG, "", [{ name: "weather-system", tag: null, version: 1 }]);
      expect((await service.detail(id)).usage[0]).toMatchObject({ environment: "", tag: "" });
    });
  });
});

describe("promotion gate in PromptService (ADR-070)", () => {
  const verdict = (extra: Partial<PromptGateResult> = {}): PromptGateResult => ({
    allowed: false, verdict: "failed", tag: "pro", version: 1, requiredRuns: 1, runs: [], reason: "The evaluation \"run 1\" does not pass: accurate 70% (target 80%).", ...extra,
  });

  async function withGate(result: PromptGateResult) {
    const calls: Array<{ tag: string; version: number }> = [];
    const service = new PromptService(fakeRepo(), {
      check: async (_prompt, tag, version) => {
        calls.push({ tag, version });
        return result;
      },
    });
    const detail = await service.create(ORG, USER, { name: "gated", content: "uno", experimentIds: [AGENT_A] });
    return { service, id: detail.prompt.id, calls };
  }

  it("refuses to move a protected environment when the gate says no, and leaves the tag where it was", async () => {
    const { service, id } = await withGate(verdict());
    const error = await service.moveTag(id, USER, { tag: "pro", version: 1 }, true).catch((e) => e);
    expect(error).toBeInstanceOf(PromptGateBlockedError);
    expect(error.message).toContain("accurate 70%");
    expect(error.gate).toMatchObject({ verdict: "failed" });
    expect((await service.detail(id)).tags).toEqual([]);
    expect((await service.detail(id)).events).toEqual([]);
  });

  it("moves it when the gate allows and records what the gate said", async () => {
    const { service, id } = await withGate(verdict({ allowed: true, verdict: "allowed" }));
    const event = await service.moveTag(id, USER, { tag: "pro", version: 1 }, true);
    expect(event).toMatchObject({ gateVerdict: "allowed", gateBypassed: false, bypassReason: null });
  });

  it("only asks the gate when promoting an environment to a version, not for free tags or when removing a tag", async () => {
    const { service, id, calls } = await withGate(verdict({ allowed: true, verdict: "allowed" }));
    await service.moveTag(id, USER, { tag: "stable", version: 1 }, true);
    await service.moveTag(id, USER, { tag: "pro", version: 1 }, true);
    await service.moveTag(id, USER, { tag: "pro", version: null }, true);
    expect(calls).toEqual([{ tag: "pro", version: 1 }]);
  });

  it("lets someone with governance skip the gate with a reason, and keeps that in the history", async () => {
    const { service, id } = await withGate(verdict());
    const event = await service.moveTag(id, USER, { tag: "pro", version: 1, bypassReason: "Hotfix for the outage of the 8th" }, true, true);
    expect(event).toMatchObject({ gateVerdict: "failed", gateBypassed: true, bypassReason: "Hotfix for the outage of the 8th" });
    expect((await service.detail(id)).events[0]).toMatchObject({ gateBypassed: true });
  });

  it("does not let anyone else skip it, even asking nicely", async () => {
    const { service, id } = await withGate(verdict());
    const error = await service.moveTag(id, USER, { tag: "pro", version: 1, bypassReason: "I am in a hurry" }, true, false).catch((e) => e);
    expect(error).toBeInstanceOf(PromptGateBlockedError);
    expect(error.message).toContain("governance permission");
  });

  it("wants a real reason to skip the gate", async () => {
    const { service, id } = await withGate(verdict());
    await expect(service.moveTag(id, USER, { tag: "pro", version: 1, bypassReason: "no" }, true, true)).rejects.toBeInstanceOf(ValidationError);
  });

  it("does not record a bypass when the gate would have allowed it anyway", async () => {
    const { service, id } = await withGate(verdict({ allowed: true, verdict: "allowed" }));
    const event = await service.moveTag(id, USER, { tag: "pro", version: 1, bypassReason: "just in case" }, true, true);
    expect(event.gateBypassed).toBe(false);
  });

  it("still needs the promote permission before the gate is even consulted", async () => {
    const { service, id, calls } = await withGate(verdict({ allowed: true, verdict: "allowed" }));
    await expect(service.moveTag(id, USER, { tag: "pro", version: 1 }, false)).rejects.toBeInstanceOf(PromptPromoteForbiddenError);
    expect(calls).toEqual([]);
  });

  it("without a gate wired, tags move as before", async () => {
    const service = new PromptService(fakeRepo());
    const detail = await service.create(ORG, USER, { name: "free", content: "uno" });
    await expect(service.moveTag(detail.prompt.id, USER, { tag: "pro", version: 1 }, true)).resolves.toMatchObject({ gateVerdict: "not_gated" });
  });

  it("shows the policy and the protected environments in the detail", async () => {
    const repo = fakeRepo();
    const service = new PromptService(repo);
    const created = await service.create(ORG, USER, { name: "with-policy", content: "uno" });
    expect((await service.detail(created.prompt.id)).policy).toBeNull();
    await repo.setPolicy(created.prompt.id, { datasetId: "d1", requiredRuns: 2 }, USER);
    const detail = await service.detail(created.prompt.id);
    expect(detail.policy).toMatchObject({ datasetId: "d1", requiredRuns: 2 });
    expect(detail.gatedEnvironments).toEqual(["pre", "pro"]);
  });
});

describe("override tokens and the playground (ADR-071)", () => {
  const DEV = { id: "dep-dev", environment: { key: "dev", isProduction: false } };
  const PRO = { id: "dep-pro", environment: { key: "pro", isProduction: true } };

  /** Un agente de mentira: lee la cabecera y, si `listens`, presenta el token a MemTrace como haría el SDK. */
  function setup(options: { listens?: boolean } = {}) {
    const repo = fakeRepo();
    const service = new PromptService(repo);
    const sent: Array<Record<string, string> | undefined> = [];
    let tokenSeen: string | null = null;
    const registry = {
      getCard: async () => ({ deployments: [DEV, PRO] }),
      chat: async (_experimentId: string, _deploymentId: string, input: { message: string; headers?: Record<string, string> }) => {
        sent.push(input.headers);
        tokenSeen = input.headers?.[PROMPT_OVERRIDE_HEADER] ?? null;
        let reply = `respuesta con el prompt del tag a "${input.message}"`;
        if ((options.listens ?? true) && tokenSeen) {
          const granted = await service.resolveOverride(AGENT_A, ORG, "weather-system", tokenSeen);
          reply = `respuesta con v${granted.version.version}: ${granted.version.content}`;
        }
        return { reply, sessionId: null, traceId: "a".repeat(32), latencyMs: 12 };
      },
    };
    const playground = new PromptPlaygroundService(repo, registry as never, {} as never);
    return { repo, service, playground, sent, token: () => tokenSeen };
  }

  async function seeded(ctx: ReturnType<typeof setup>) {
    const created = await ctx.service.create(ORG, USER, { name: "weather-system", content: "uno", experimentIds: [AGENT_A] });
    await ctx.service.saveVersion(created.prompt.id, USER, { content: "dos" });
    return { prompt: created.prompt };
  }

  it("runs the chosen version in the real agent and proves the agent applied it", async () => {
    const ctx = setup();
    const { prompt } = await seeded(ctx);
    const result = await ctx.playground.run(prompt, AGENT_A, USER, { deploymentId: "dep-dev", version: 2, message: "¿Lloverá?" });
    expect(result).toMatchObject({ version: 2, applied: true, traceId: "a".repeat(32) });
    expect(result.reply).toBe("respuesta con v2: dos");
  });

  it("says so when the agent answered without asking for the version, instead of passing the answer off as that version's", async () => {
    const ctx = setup({ listens: false });
    const { prompt } = await seeded(ctx);
    const result = await ctx.playground.run(prompt, AGENT_A, USER, { deploymentId: "dep-dev", version: 2, message: "hola" });
    expect(result.applied).toBe(false);
    expect(result.reply).toContain("del tag");
  });

  it("never runs against a production environment, and does not even mint a token", async () => {
    const ctx = setup();
    const { prompt } = await seeded(ctx);
    await expect(ctx.playground.run(prompt, AGENT_A, USER, { deploymentId: "dep-pro", version: 1, message: "hola" })).rejects.toBeInstanceOf(PromptInvariantError);
    expect(ctx.sent).toEqual([]);
    expect(ctx.repo.__overrides.size).toBe(0);
  });

  it("sends the token in the override header and stores only its hash", async () => {
    const ctx = setup();
    const { prompt } = await seeded(ctx);
    await ctx.playground.run(prompt, AGENT_A, USER, { deploymentId: "dep-dev", version: 1, message: "hola" });
    const token = ctx.token()!;
    expect(token).toMatch(/^mto_[A-Za-z0-9_-]{40,}$/);
    expect(ctx.repo.__overrides.has(token)).toBe(false);
    expect(ctx.repo.__overrides.has(hashOverrideToken(token))).toBe(true);
  });

  it("every run gets its own token", async () => {
    const ctx = setup();
    const { prompt } = await seeded(ctx);
    await ctx.playground.run(prompt, AGENT_A, USER, { deploymentId: "dep-dev", version: 1, message: "a" });
    const first = ctx.token();
    await ctx.playground.run(prompt, AGENT_A, USER, { deploymentId: "dep-dev", version: 2, message: "b" });
    expect(ctx.token()).not.toBe(first);
    expect(ctx.repo.__overrides.size).toBe(2);
  });

  it("rejects what cannot be run: another agent's prompt, an unknown deployment or version, an empty or huge message", async () => {
    const ctx = setup();
    const { prompt } = await seeded(ctx);
    const run = (extra: object) => ctx.playground.run(prompt, AGENT_A, USER, { deploymentId: "dep-dev", version: 1, message: "hola", ...extra });
    await expect(ctx.playground.run(prompt, AGENT_B, USER, { deploymentId: "dep-dev", version: 1, message: "hola" })).rejects.toBeInstanceOf(PromptNotFoundError);
    await expect(run({ deploymentId: "nope" })).rejects.toBeInstanceOf(AssistantNotFoundError);
    await expect(run({ version: 9 })).rejects.toBeInstanceOf(PromptNotFoundError);
    await expect(run({ message: "   " })).rejects.toBeInstanceOf(ValidationError);
    await expect(run({ message: "x".repeat(4001) })).rejects.toBeInstanceOf(ValidationError);
    expect(ctx.sent).toEqual([]);
  });

  it("a token only works for the agent and the prompt it was issued for", async () => {
    const ctx = setup();
    const { prompt } = await seeded(ctx);
    await ctx.service.create(ORG, USER, { name: "other-prompt", content: "otro", experimentIds: [AGENT_A] });
    await ctx.playground.run(prompt, AGENT_A, USER, { deploymentId: "dep-dev", version: 1, message: "hola" });
    const token = ctx.token()!;
    await expect(ctx.service.resolveOverride(AGENT_A, ORG, "other-prompt", token)).rejects.toBeInstanceOf(PromptNotFoundError); // another prompt
    await expect(ctx.service.resolveOverride(AGENT_B, ORG, "weather-system", token)).rejects.toBeInstanceOf(PromptNotFoundError); // another agent
    await expect(ctx.service.resolveOverride(AGENT_A, ORG, "weather-system", "mto_inventado_inventado")).rejects.toBeInstanceOf(PromptNotFoundError);
  });

  it("an expired token is the same as no token", async () => {
    const ctx = setup();
    const { prompt } = await seeded(ctx);
    await ctx.repo.createOverride({ tokenHash: hashOverrideToken("mto_caducado_caducado"), experimentId: AGENT_A, promptId: prompt.id, version: 1, userId: USER, ttlSeconds: 0 });
    await expect(ctx.service.resolveOverride(AGENT_A, ORG, "weather-system", "mto_caducado_caducado")).rejects.toBeInstanceOf(PromptNotFoundError);
  });
});

describe("drafts and fixes from failures (ADR-072)", () => {
  const TRACE = "ab".repeat(16);

  async function seeded() {
    const service = new PromptService(fakeRepo());
    const created = await service.create(ORG, USER, { name: "weather-system", content: "uno {{ciudad}}", experimentIds: [AGENT_A] });
    return { service, id: created.prompt.id };
  }
  const fix = { traceIds: [TRACE], cause: "429 Too Many Requests", rationale: "Retry with a shorter prompt" };

  it("saves a proposal as a draft with the failure that motivated it, and does not touch the published ones", async () => {
    const { service, id } = await seeded();
    const draft = await service.saveVersion(id, USER, { content: "dos {{ciudad}}", draft: true, origin: fix, message: "shorter" });
    expect(draft).toMatchObject({ version: 2, status: "draft", publishedAt: null, origin: { kind: "fix", traceIds: [TRACE], cause: "429 Too Many Requests", rationale: "Retry with a shorter prompt" } });
    const { versions } = await service.detail(id);
    expect(versions.map((v) => [v.version, v.status])).toEqual([[2, "draft"], [1, "published"]]);
  });

  it("a draft is not the base of the next version: it starts from the last published one", async () => {
    const { service, id } = await seeded();
    await service.saveVersion(id, USER, { content: "dos", draft: true });
    const next = await service.saveVersion(id, USER, { content: "tres" });
    expect(next).toMatchObject({ version: 3, status: "published", parentVersion: 1 });
  });

  it("does not save a draft identical to the published text or to the last draft", async () => {
    const { service, id } = await seeded();
    await expect(service.saveVersion(id, USER, { content: "uno {{ciudad}}", draft: true })).rejects.toBeInstanceOf(PromptInvariantError);
    await service.saveVersion(id, USER, { content: "dos", draft: true });
    await expect(service.saveVersion(id, USER, { content: "dos", draft: true })).rejects.toBeInstanceOf(PromptInvariantError);
  });

  it("refuses to point any tag at a draft, until it is published", async () => {
    const { service, id } = await seeded();
    await service.saveVersion(id, USER, { content: "dos", draft: true });
    await expect(service.moveTag(id, USER, { tag: "pro", version: 2 }, true)).rejects.toThrow(/draft/);
    await expect(service.moveTag(id, USER, { tag: "stable", version: 2 }, true)).rejects.toThrow(/draft/);
    await service.publishDraft(id, 2);
    await expect(service.moveTag(id, USER, { tag: "stable", version: 2 }, true)).resolves.toMatchObject({ toVersion: 2 });
  });

  it("publishing turns it into a normal version once, and a published version cannot be published again", async () => {
    const { service, id } = await seeded();
    await service.saveVersion(id, USER, { content: "dos", draft: true });
    expect(await service.publishDraft(id, 2)).toMatchObject({ status: "published", publishedAt: expect.any(String) });
    await expect(service.publishDraft(id, 2)).rejects.toBeInstanceOf(PromptInvariantError);
    await expect(service.publishDraft(id, 1)).rejects.toBeInstanceOf(PromptInvariantError);
  });

  it("discards a draft but never a published version, and never reuses the number", async () => {
    const { service, id } = await seeded();
    await service.saveVersion(id, USER, { content: "dos", draft: true });
    await service.discardDraft(id, 2);
    await expect(service.discardDraft(id, 1)).rejects.toBeInstanceOf(PromptInvariantError);
    const again = await service.saveVersion(id, USER, { content: "tres" });
    expect(again.version).toBe(3); // v2 may have been tested and traced: its number never means anything else
  });

  it("does not publish or discard in an archived prompt", async () => {
    const { service, id } = await seeded();
    await service.saveVersion(id, USER, { content: "dos", draft: true });
    await service.update(id, { archived: true });
    await expect(service.publishDraft(id, 2)).rejects.toBeInstanceOf(PromptInvariantError);
  });

  it("rejects an origin that is not a failure description: bad trace ids or too many", async () => {
    const { service, id } = await seeded();
    await expect(service.saveVersion(id, USER, { content: "dos", draft: true, origin: { traceIds: ["nope"] } })).rejects.toBeInstanceOf(ValidationError);
    await expect(service.saveVersion(id, USER, { content: "dos", draft: true, origin: { traceIds: Array.from({ length: 11 }, (_, i) => i.toString(16).padStart(32, "0")) } })).rejects.toBeInstanceOf(ValidationError);
  });

  it("a team tool with the agent's key can only propose drafts, for prompts of that agent", async () => {
    const { service } = await seeded();
    const saved = await service.saveDraftForAgent(AGENT_A, ORG, USER, { name: "weather-system", content: "propuesta", origin: fix });
    expect(saved.version).toMatchObject({ status: "draft", version: 2, parentVersion: 1 });
    await expect(service.saveDraftForAgent(AGENT_B, ORG, USER, { name: "weather-system", content: "otra" })).rejects.toBeInstanceOf(PromptNotFoundError);
    await expect(service.saveDraftForAgent(AGENT_A, ORG, USER, { name: "no-existe", content: "otra" })).rejects.toBeInstanceOf(PromptNotFoundError);
  });

  it("drafts do not count as the latest version of the prompt", async () => {
    const { service, id } = await seeded();
    await service.saveVersion(id, USER, { content: "dos", draft: true });
    expect((await service.list(ORG))[0]!.latestVersion).toBe(1);
  });

  it("a draft can still be tested in the playground and resolved by number, so it can be evaluated before publishing", async () => {
    const { service, id } = await seeded();
    await service.saveVersion(id, USER, { content: "dos", draft: true });
    expect((await service.resolve(id, "2")).status).toBe("draft");
    expect((await service.resolveForAgent(AGENT_A, ORG, "weather-system", { version: 2 })).version.status).toBe("draft");
  });
});

describe("fragments (ADR-073)", () => {
  async function seeded() {
    const service = new PromptService(fakeRepo());
    const tone = (await service.create(ORG, USER, { name: "tone", kind: "fragment", content: "Sé amable y breve." })).prompt;
    await service.moveTag(tone.id, USER, { tag: "pro", version: 1 }, true);
    return { service, tone };
  }
  const agent = { name: "weather-system", experimentIds: [AGENT_A] };

  it("creates a fragment as a prompt of its own kind", async () => {
    const { tone } = await seeded();
    expect(tone.kind).toBe("fragment");
  });

  it("resolves an include by tag and pins the exact version of the fragment", async () => {
    const { service } = await seeded();
    const created = await service.create(ORG, USER, { ...agent, content: "Eres un asistente del tiempo.\n{{> tone@pro}}\nCiudad: {{ciudad}}." });
    const v1 = created.versions[0]!;
    expect(v1.content).toBe("Eres un asistente del tiempo.\nSé amable y breve.\nCiudad: {{ciudad}}.");
    expect(v1.source).toBe("Eres un asistente del tiempo.\n{{> tone@pro}}\nCiudad: {{ciudad}}.");
    expect(v1.includes).toEqual([{ name: "tone", ref: "pro", version: 1 }]);
    expect(v1.variables).toEqual(["ciudad"]);
  });

  it("resolves an include by version number", async () => {
    const { service } = await seeded();
    const created = await service.create(ORG, USER, { ...agent, content: "{{> tone@1}}" });
    expect(created.versions[0]).toMatchObject({ content: "Sé amable y breve.", includes: [{ name: "tone", ref: "1", version: 1 }] });
  });

  it("a version without includes keeps no source: content is what was written", async () => {
    const { service } = await seeded();
    const created = await service.create(ORG, USER, { ...agent, content: "Texto normal." });
    expect(created.versions[0]).toMatchObject({ content: "Texto normal.", source: null, includes: [] });
  });

  it("brings the fragment's variables to the prompt", async () => {
    const service = new PromptService(fakeRepo());
    await service.create(ORG, USER, { name: "policy", kind: "fragment", content: "Cumple la política de {{pais}}." });
    const frag = (await service.list(ORG)).find((p) => p.name === "policy")!;
    await service.moveTag(frag.id, USER, { tag: "pro", version: 1 }, true);
    const created = await service.create(ORG, USER, { ...agent, content: "Hola {{ciudad}}. {{> policy@pro}}" });
    expect(created.versions[0]!.variables).toEqual(["ciudad", "pais"]);
  });

  it("is reproducible: the version keeps the text it was saved with even when the fragment changes later", async () => {
    const { service, tone } = await seeded();
    const created = await service.create(ORG, USER, { ...agent, content: "{{> tone@pro}}" });
    await service.saveVersion(tone.id, USER, { content: "Sé formal." });
    await service.moveTag(tone.id, USER, { tag: "pro", version: 2 }, true);
    const detail = await service.detail(created.prompt.id);
    expect(detail.versions[0]!.content).toBe("Sé amable y breve."); // not retroactively changed
    expect(detail.includes).toEqual([{ name: "tone", ref: "pro", pinned: 1, current: 2, outdated: true }]);
  });

  it("a reference by number never goes out of date", async () => {
    const { service, tone } = await seeded();
    const created = await service.create(ORG, USER, { ...agent, content: "{{> tone@1}}" });
    await service.saveVersion(tone.id, USER, { content: "Sé formal." });
    expect((await service.detail(created.prompt.id)).includes).toEqual([{ name: "tone", ref: "1", pinned: 1, current: 1, outdated: false }]);
  });

  it("rejects an include that cannot be resolved, saying which", async () => {
    const { service } = await seeded();
    const create = (content: string) => service.create(ORG, USER, { ...agent, name: `p-${Math.random().toString(36).slice(2, 8)}`, content });
    await expect(create("{{> nope@pro}}")).rejects.toThrow(ValidationError);
    await expect(create("{{> tone@stable}}")).rejects.toThrow(ValidationError); // the fragment has no such tag
    await expect(create("{{> tone@9}}")).rejects.toThrow(ValidationError);
    await expect(create("{{> tone}}")).rejects.toThrow(ValidationError); // no reference: not guessed
  });

  it("cannot include a normal prompt, an archived fragment or a draft", async () => {
    const { service, tone } = await seeded();
    const why = async (promise: Promise<unknown>) => ((await promise.catch((e) => e)) as ValidationError).fields.content;
    await service.create(ORG, USER, { name: "plain", content: "texto" });
    expect(await why(service.create(ORG, USER, { ...agent, content: "{{> plain@1}}" }))).toContain("not a fragment");
    await service.saveVersion(tone.id, USER, { content: "Borrador", draft: true });
    expect(await why(service.create(ORG, USER, { ...agent, name: "uses-draft", content: "{{> tone@2}}" }))).toContain("published");
    await service.update(tone.id, { archived: true });
    expect(await why(service.create(ORG, USER, { ...agent, name: "uses-archived", content: "{{> tone@pro}}" }))).toContain("archived");
  });

  it("fragments are flat: a fragment cannot include another", async () => {
    const { service } = await seeded();
    await expect(service.create(ORG, USER, { name: "nested", kind: "fragment", content: "{{> tone@pro}}" })).rejects.toThrow(/cannot include other fragments/);
  });

  it("limits how many fragments one prompt includes", async () => {
    const { service } = await seeded();
    const many = Array.from({ length: 21 }, (_, i) => `{{> tone@${i + 1}}}`).join("\n");
    await expect(service.create(ORG, USER, { ...agent, content: many })).rejects.toThrow(/Too many includes/);
  });

  it("editing the source keeps the includes; the saved text is deduplicated on the resolved text", async () => {
    const { service } = await seeded();
    const { prompt } = await service.create(ORG, USER, { ...agent, content: "Intro.\n{{> tone@pro}}" });
    await expect(service.saveVersion(prompt.id, USER, { content: "Intro.\n{{> tone@pro}}" })).rejects.toThrow(/No changes/);
    const next = await service.saveVersion(prompt.id, USER, { content: "Intro nueva.\n{{> tone@pro}}" });
    expect(next).toMatchObject({ source: "Intro nueva.\n{{> tone@pro}}", includes: [{ name: "tone", ref: "pro", version: 1 }] });
  });

  it("lists the prompts that use a fragment and which of them are behind", async () => {
    const { service, tone } = await seeded();
    const a = await service.create(ORG, USER, { ...agent, name: "uses-tag", content: "{{> tone@pro}}" });
    await service.create(ORG, USER, { ...agent, name: "uses-number", content: "{{> tone@1}}" });
    await service.saveVersion(tone.id, USER, { content: "Sé formal." });
    await service.moveTag(tone.id, USER, { tag: "pro", version: 2 }, true);
    const usedBy = (await service.detail(tone.id)).usedBy;
    expect(usedBy.map((u) => [u.name, u.outdated])).toEqual([["uses-number", false], ["uses-tag", true]]);
    expect((await service.outdatedDependents(tone.id)).map((u) => u.promptId)).toEqual([a.prompt.id]);
  });

  it("rebuilding re-resolves against today's fragments and proposes the result as a DRAFT", async () => {
    const { service, tone } = await seeded();
    const { prompt } = await service.create(ORG, USER, { ...agent, content: "Intro.\n{{> tone@pro}}" });
    await service.saveVersion(tone.id, USER, { content: "Sé formal." });
    await service.moveTag(tone.id, USER, { tag: "pro", version: 2 }, true);
    const draft = await service.rebuild(prompt.id, USER);
    expect(draft).toMatchObject({ status: "draft", content: "Intro.\nSé formal.", includes: [{ name: "tone", ref: "pro", version: 2 }], message: "Rebuilt with the current fragments" });
    expect((await service.detail(prompt.id)).versions.find((v) => v.version === 1)!.content).toBe("Intro.\nSé amable y breve."); // the published one is untouched
  });

  it("does not rebuild what is already up to date, or what includes nothing", async () => {
    const { service } = await seeded();
    const withInclude = await service.create(ORG, USER, { ...agent, content: "{{> tone@pro}}" });
    await expect(service.rebuild(withInclude.prompt.id, USER)).rejects.toThrow(/Already up to date/);
    const plain = await service.create(ORG, USER, { name: "plain-2", content: "nada" });
    await expect(service.rebuild(plain.prompt.id, USER)).rejects.toThrow(/nothing to rebuild/);
  });
});

describe("dependency map (ADR-074)", () => {
  const names: Record<string, string> = { [AGENT_A]: "weather", [AGENT_B]: "billing" };
  const identity = {
    getExperiment: async (id: string) => (names[id] ? { id, organizationId: ORG, name: names[id], serviceName: id } : null),
    getDataset: async (id: string) => (id === "ds-1" ? { id, experimentId: AGENT_A, name: "golden", createdAt: "t" } : null),
  } as unknown as IdentityRepository;

  async function setup() {
    const repo = fakeRepo();
    const service = new PromptService(repo);
    const map = new PromptMapService(service, repo, identity);
    const tone = (await service.create(ORG, USER, { name: "tone", kind: "fragment", content: "Sé amable." })).prompt;
    await service.moveTag(tone.id, USER, { tag: "pro", version: 1 }, true);
    const main = (await service.create(ORG, USER, { name: "weather-system", content: "{{> tone@pro}}", experimentIds: [AGENT_A, AGENT_B] })).prompt;
    return { repo, service, map, tone, main };
  }

  it("lists the linked agents with what each serves per environment, and the fragments it includes", async () => {
    const { service, map, main } = await setup();
    await service.recordUsage(AGENT_A, ORG, "pro", [{ name: "weather-system", tag: "pro", version: 1 }]);
    await service.recordUsage(AGENT_A, ORG, "dev", [{ name: "weather-system", tag: "dev", version: 1 }]);
    const result = await map.map(main.id);
    expect(result.agents.map((a) => [a.name, a.serving.map((s) => s.environment)])).toEqual([["weather", ["dev", "pro"]], ["billing", []]]);
    expect(result.includes).toMatchObject([{ name: "tone", ref: "pro", pinned: 1, outdated: false }]);
    expect(result.dataset).toBeNull();
    expect(result.impact).toBeNull();
  });

  it("names the dataset of the promotion policy", async () => {
    const { repo, map, main } = await setup();
    await repo.setPolicy(main.id, { datasetId: "ds-1", requiredRuns: 2 }, USER);
    expect((await map.map(main.id)).dataset).toEqual({ id: "ds-1", name: "golden", experimentId: AGENT_A, requiredRuns: 2 });
  });

  it("shows who reads a fragment and who is behind", async () => {
    const { map, tone } = await setup();
    expect((await map.map(tone.id)).usedBy).toMatchObject([{ name: "weather-system", version: 1, outdated: false }]);
  });

  it("previews who would receive a tag move: agents following that tag, not the pinned or the other environments", async () => {
    const { service, map, main } = await setup();
    await service.saveVersion(main.id, USER, { content: "{{> tone@pro}}\nNuevo." });
    await service.recordUsage(AGENT_A, ORG, "pro", [{ name: "weather-system", tag: "pro", version: 1 }]);
    await service.recordUsage(AGENT_B, ORG, "dev", [{ name: "weather-system", tag: "dev", version: 1 }]);
    await service.recordUsage(AGENT_B, ORG, "", [{ name: "weather-system", tag: null, version: 1 }]);
    const impact = (await map.map(main.id, { tag: "pro", version: 2 })).impact!;
    expect(impact.agents).toEqual([{ experimentId: AGENT_A, name: "weather", environment: "pro", from: 1, to: 2, changes: true }]);
    expect(impact.pinned).toBe(1);
  });

  it("moving a fragment tag leaves the prompts that include it behind, without changing them", async () => {
    const { service, map, tone } = await setup();
    await service.saveVersion(tone.id, USER, { content: "Sé formal." });
    expect((await map.map(tone.id, { tag: "pro", version: 2 })).impact!.willBeBehind).toEqual([{ promptId: expect.any(String), name: "weather-system" }]);
    expect((await map.map(tone.id, { tag: "pro", version: 1 })).impact!.willBeBehind).toEqual([]); // not a move
  });
});

describe("promotionImpact", () => {
  const agent = { experimentId: "a", name: "weather", serving: [{ environment: "pro", tag: "pro", version: 3, lastSeenAt: "t" }] };
  it("an agent already on the target version is listed but does not change", () => {
    const impact = promotionImpact({ tag: "pro", toVersion: 3, agents: [agent], dependents: [], currentVersion: 3 });
    expect(impact.agents).toEqual([expect.objectContaining({ changes: false })]);
  });
  it("ignores dependents that reference the fragment by number or by another tag", () => {
    const impact = promotionImpact({ tag: "pro", toVersion: 4, agents: [], currentVersion: 3, dependents: [{ promptId: "x", name: "a", refs: ["2"] }, { promptId: "y", name: "b", refs: ["dev"] }, { promptId: "z", name: "c", refs: ["pro"] }] });
    expect(impact.willBeBehind.map((d) => d.name)).toEqual(["c"]);
  });
});

describe("replaying earlier turns in the playground (ADR-075)", () => {
  function setup(sessionField: string | null) {
    const repo = fakeRepo();
    const service = new PromptService(repo);
    const sent: Array<{ message: string; sessionId: string | null }> = [];
    const registry = {
      getCard: async () => ({ deployments: [{ id: "dep-dev", environment: { key: "dev", isProduction: false } }], chat: { sessionField } }),
      chat: async (_e: string, _d: string, input: { message: string; sessionId: string | null }) => {
        sent.push({ message: input.message, sessionId: input.sessionId });
        return { reply: `ok: ${input.message}`, sessionId: sessionField ? "s1" : null, traceId: null, latencyMs: 5 };
      },
    };
    return { service, sent, playground: new PromptPlaygroundService(repo, registry as never, {} as never) };
  }
  async function prompt(service: PromptService) {
    return (await service.create(ORG, USER, { name: "weather-system", content: "uno", experimentIds: [AGENT_A] })).prompt;
  }

  it("sends the earlier messages first, in the same session, and answers the last one", async () => {
    const { service, sent, playground } = setup("session_id");
    const result = await playground.run(await prompt(service), AGENT_A, USER, { deploymentId: "dep-dev", version: 1, message: "¿Lloverá el viernes?", history: ["Hola", "Voy a Valencia"] });
    expect(sent).toEqual([
      { message: "Hola", sessionId: null },
      { message: "Voy a Valencia", sessionId: "s1" },
      { message: "¿Lloverá el viernes?", sessionId: "s1" },
    ]);
    expect(result.reply).toBe("ok: ¿Lloverá el viernes?");
  });

  it("refuses to replay when the agent keeps no session, instead of dropping the context silently", async () => {
    const { service, sent, playground } = setup(null);
    await expect(playground.run(await prompt(service), AGENT_A, USER, { deploymentId: "dep-dev", version: 1, message: "hola", history: ["antes"] })).rejects.toThrow(/no session/);
    expect(sent).toEqual([]);
  });

  it("works as before without history, even if the agent keeps no session", async () => {
    const { service, sent, playground } = setup(null);
    await playground.run(await prompt(service), AGENT_A, USER, { deploymentId: "dep-dev", version: 1, message: "hola" });
    expect(sent).toEqual([{ message: "hola", sessionId: null }]);
  });

  it("limits how many earlier messages are replayed", async () => {
    const { service, playground } = setup("session_id");
    await expect(playground.run(await prompt(service), AGENT_A, USER, { deploymentId: "dep-dev", version: 1, message: "hola", history: Array.from({ length: 11 }, () => "x") })).rejects.toBeInstanceOf(ValidationError);
  });
});
