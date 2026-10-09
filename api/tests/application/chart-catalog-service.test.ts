import { describe, expect, it } from "vitest";
import { ChartCatalogService } from "@/application/chart-catalog-service";
import type { ChartCatalogRepository } from "@/application/ports/chart-catalog-repository";
import { MAX_ENTRIES, type CatalogEntry } from "@/domain/chart-catalog";
import { ValidationError } from "@/domain/errors";

const EXP = "exp-1";
const USER = "user-1";

/** Repositorio en memoria con las mismas reglas que el de Postgres (una fila por experimento, tipo y clave). */
function fakeRepo() {
  const rows = new Map<string, CatalogEntry>();
  const id = (exp: string, kind: string, key: string) => `${exp}|${kind}|${key}`;
  const repo: ChartCatalogRepository = {
    list: async (exp) => [...rows.entries()].filter(([k]) => k.startsWith(`${exp}|`)).map(([, v]) => v),
    upsert: async (exp, e, userId) => {
      const saved: CatalogEntry = { ...e, updatedBy: userId, updatedAt: "t" };
      rows.set(id(exp, e.kind, e.key), saved);
      return saved;
    },
    delete: async (exp, kind, key) => rows.delete(id(exp, kind, key)),
  };
  return { repo, rows };
}

const setup = () => {
  const f = fakeRepo();
  return { ...f, service: new ChartCatalogService(f.repo) };
};

describe("ChartCatalogService", () => {
  it("names a step and lists it back", async () => {
    const { service } = setup();
    const saved = await service.save(EXP, USER, { kind: "step", key: "input_guardrail", displayName: "  Personal data filter " });
    expect(saved).toMatchObject({ kind: "step", key: "input_guardrail", displayName: "Personal data filter", visibility: "auto", updatedBy: USER });
    expect((await service.list(EXP)).map((e) => e.key)).toEqual(["input_guardrail"]);
  });

  it("changes an existing name instead of adding a second entry", async () => {
    const { service } = setup();
    await service.save(EXP, USER, { kind: "attribute", key: "gen_ai.tool.name", displayName: "Tool" });
    await service.save(EXP, USER, { kind: "attribute", key: "gen_ai.tool.name", displayName: "Tool used" });
    const all = await service.list(EXP);
    expect(all).toHaveLength(1);
    expect(all[0]!.displayName).toBe("Tool used");
  });

  it("an edit that says nothing removes the entry and answers null", async () => {
    const { service } = setup();
    await service.save(EXP, USER, { kind: "step", key: "s", displayName: "Name" });
    expect(await service.save(EXP, USER, { kind: "step", key: "s", displayName: "", visibility: "auto" })).toBeNull();
    expect(await service.list(EXP)).toEqual([]);
  });

  it("keeps an entry that only changes visibility", async () => {
    const { service } = setup();
    const saved = await service.save(EXP, USER, { kind: "attribute", key: "customer_id", visibility: "hidden" });
    expect(saved).toMatchObject({ displayName: null, visibility: "hidden" });
  });

  it("refuses a name another entry of the same kind already uses, in any case", async () => {
    const { service } = setup();
    await service.save(EXP, USER, { kind: "step", key: "a", displayName: "Filter" });
    await expect(service.save(EXP, USER, { kind: "step", key: "b", displayName: "filter" })).rejects.toBeInstanceOf(ValidationError);
    // otro tipo u otro experimento sí pueden repetirlo
    await expect(service.save(EXP, USER, { kind: "attribute", key: "b", displayName: "Filter" })).resolves.toBeDefined();
    await expect(service.save("exp-2", USER, { kind: "step", key: "b", displayName: "Filter" })).resolves.toBeDefined();
  });

  it("validates kind, key and name", async () => {
    const { service } = setup();
    await expect(service.save(EXP, USER, { kind: "span", key: "k", displayName: "x" })).rejects.toBeInstanceOf(ValidationError);
    await expect(service.save(EXP, USER, { kind: "step", key: " ", displayName: "x" })).rejects.toBeInstanceOf(ValidationError);
    await expect(service.save(EXP, USER, { kind: "step", key: "k", displayName: "x".repeat(200) })).rejects.toBeInstanceOf(ValidationError);
  });

  it("caps how many items an experiment can edit, but still lets existing ones change", async () => {
    const { service, rows } = setup();
    for (let i = 0; i < MAX_ENTRIES; i += 1) rows.set(`${EXP}|attribute|k${i}`, { kind: "attribute", key: `k${i}`, displayName: `N${i}`, visibility: "auto", updatedBy: null, updatedAt: "t" });
    await expect(service.save(EXP, USER, { kind: "attribute", key: "one-more", displayName: "More" })).rejects.toBeInstanceOf(ValidationError);
    await expect(service.save(EXP, USER, { kind: "attribute", key: "k0", displayName: "Renamed" })).resolves.toBeDefined();
  });

  it("goes back to automatic without failing when there was nothing to remove", async () => {
    const { service } = setup();
    await service.save(EXP, USER, { kind: "step", key: "s", displayName: "Name" });
    expect(await service.remove(EXP, "step", "s")).toBe(true);
    expect(await service.remove(EXP, "step", "s")).toBe(false);
  });
});
