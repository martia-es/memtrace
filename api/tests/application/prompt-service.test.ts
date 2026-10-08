import { describe, expect, it } from "vitest";
import { PromptService } from "@/application/prompt-service";
import type { PromptRepository } from "@/application/ports/prompt-repository";
import { PromptInvariantError, PromptNotFoundError, PromptPromoteForbiddenError, ValidationError } from "@/domain/errors";
import type { NewPrompt, NewPromptVersion, Prompt, PromptSummary, PromptTag, PromptTagEvent, PromptUsage, PromptVersion, UsageItem } from "@/domain/prompt";

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
  let seq = 0;

  const repo: PromptRepository = {
    environmentKeys: async () => ["dev", "pre", "pro"],
    experimentsInOrganization: async (_org, ids) => ids.filter((id) => id !== FOREIGN),
    create: async (input: NewPrompt, first: Omit<NewPromptVersion, "promptId">) => {
      if ([...prompts.values()].some((p) => p.name === input.name)) throw new PromptInvariantError(`A prompt named "${input.name}" already exists in this organization`);
      const id = `p${++seq}`;
      const prompt: Prompt = { id, organizationId: input.organizationId, name: input.name, description: input.description, archivedAt: null, createdBy: input.createdBy, createdAt: "t", updatedAt: "t", experimentIds: input.experimentIds };
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
        out.push({ ...p, latestVersion: versions.get(p.id)!.length, tags: Object.fromEntries(tags.get(p.id)!) });
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
      const version: PromptVersion = { id: `v${++seq}`, promptId: input.promptId, version: list.length + 1, content: input.content, variables: input.variables, contentHash: input.contentHash, parentVersion: input.parentVersion, message: input.message, createdBy: input.createdBy, createdAt: "t" };
      list.push(version);
      return version;
    },
    listVersions: async (id) => [...(versions.get(id) ?? [])].reverse(),
    getVersion: async (id, n) => versions.get(id)?.find((v) => v.version === n) ?? null,
    getVersionByTag: async (id, tag) => {
      const n = tags.get(id)?.get(tag);
      return n === undefined ? null : (versions.get(id)!.find((v) => v.version === n) ?? null);
    },
    listTags: async (id): Promise<PromptTag[]> => [...(tags.get(id) ?? [])].map(([tag, version]) => ({ tag, version, updatedBy: USER, updatedAt: "t" })),
    moveTag: async (id, tag, version, userId, reason) => {
      if (version !== null && !versions.get(id)!.some((v) => v.version === version)) return null;
      const from = tags.get(id)!.get(tag) ?? null;
      if (version === null) tags.get(id)!.delete(tag);
      else tags.get(id)!.set(tag, version);
      const event: PromptTagEvent = { id: `e${++seq}`, tag, fromVersion: from, toVersion: version, changedBy: userId, reason, createdAt: "t" };
      events.get(id)!.unshift(event);
      return event;
    },
    tagEvents: async (id) => events.get(id) ?? [],
    recordUsage: async (experimentId, environment, items) => {
      for (const item of items) usage.push({ ...item, experimentId, environment });
    },
    listUsage: async (id): Promise<PromptUsage[]> =>
      usage.filter((u) => u.promptId === id).map((u) => ({ experimentId: u.experimentId, environment: u.environment, tag: u.tag, version: u.version, firstSeenAt: "t", lastSeenAt: "t" })),
  };
  return repo;
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
