import type { AuditService } from "@/application/audit-service";
import type { ModelQualityRepository } from "@/application/ports/model-quality-repository";
import type { TraceRepository } from "@/application/ports/trace-repository";
import { ValidationError } from "@/domain/errors";
import { candidatesFor, isPending, modelKey as keyOf, resolveModelQuality, type ArenaModel, type ModelQualityRow, type QualityCandidate } from "@/domain/model-quality";
import type { TenantScope } from "@/domain/tenant";

const CACHE_TTL_MS = 5 * 60 * 1000;
/** «En uso» = visto en las trazas de los últimos 30 días */
const IN_USE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface Actor {
  userId: string;
  email: string;
}

/** El experimento sobre el que se pregunta y su organización (las decisiones son de la organización, lo «en uso» del experimento). */
export interface ExperimentRef {
  organizationId: string;
  scope: TenantScope;
}

export interface QualitySource {
  name: string;
  board: string;
  category: string;
  license: string;
  url: string;
  /** fecha del leaderboard más reciente que hay guardado; null si el worker aún no ha sincronizado nada */
  publishedAt: string | null;
  syncedAt: string | null;
}

export interface QualityOverview {
  source: QualitySource;
  /** solo los modelos con algo que contar: con puntuación, candidato, sin equivalente o en uso. El resto no aporta nada a la tabla. */
  items: ModelQualityRow[];
  counts: {
    /** claves con candidatos y sin decidir, usadas o no */
    needsReview: number;
    /** de ellas, las que aparecen en las trazas del experimento */
    pending: number;
    inUse: number;
  };
}

export interface CandidateGroup {
  modelKey: string;
  /** un id del catálogo que represente la clave: el que coincide con ella, o el más corto */
  model: string;
  inUse: boolean;
  candidates: QualityCandidate[];
}

export type MatchChange = { decision: "confirm"; arenaName: string } | { decision: "reject"; arenaNames: string[] } | { decision: "no_equivalent" };

export interface PendingItem {
  experimentId: string;
  modelKey: string;
  model: string;
  candidateCount: number;
}

const SOURCE = { name: "Arena", board: "text", category: "overall", license: "CC BY 4.0", url: "https://arena.ai" } as const;

/**
 * Calidad por modelo (ADR-025, ampliación). Cruza el catálogo de precios con las puntuaciones de Arena, aplica las decisiones de
 * la organización y dice cuáles de los modelos que el agente usa esperan una decisión. Quién puede decidir (`pricing:manage`) lo
 * resuelve la ruta; cada decisión queda en el registro de auditoría.
 */
export class ModelQualityService {
  private cache: { atMs: number; arena: ArenaModel[]; pricingIds: string[] } | null = null;
  /** los modelos en uso cuestan una consulta sobre 30 días de trazas y la campana pregunta cada minuto: se recuerdan unos minutos */
  private usage = new Map<string, { atMs: number; models: string[] }>();

  constructor(
    private readonly traces: TraceRepository,
    private readonly decisions: ModelQualityRepository,
    private readonly audit: AuditService,
    private readonly now: () => number = Date.now,
  ) {}

  private async catalogs(): Promise<{ arena: ArenaModel[]; pricingIds: string[] }> {
    const nowMs = this.now();
    if (this.cache && nowMs - this.cache.atMs < CACHE_TTL_MS) return this.cache;
    const [arena, pricing] = await Promise.all([this.traces.getModelQuality(), this.traces.getModelPricing()]);
    this.cache = { atMs: nowMs, arena, pricingIds: pricing.map((p) => p.modelId) };
    return this.cache;
  }

  private async modelsInUse(scopes: TenantScope[]): Promise<string[]> {
    const nowMs = this.now();
    const key = scopes.map((s) => s.experimentId).sort().join(",");
    const known = this.usage.get(key);
    if (known && nowMs - known.atMs < CACHE_TTL_MS) return known.models;
    const models = await this.traces.listModelsInUse(scopes, { fromMs: nowMs - IN_USE_DAYS * DAY_MS, toMs: nowMs });
    if (this.usage.size > 200) this.usage.clear(); // acotado: una clave por conjunto de experimentos
    this.usage.set(key, { atMs: nowMs, models });
    return models;
  }

  private async resolve(organizationId: string, scopes: TenantScope[]) {
    const nowMs = this.now();
    const [{ arena, pricingIds }, decisions, usedModels] = await Promise.all([this.catalogs(), this.decisions.listDecisions(organizationId), this.modelsInUse(scopes)]);
    const { rows, latestPublishedAtMs } = resolveModelQuality({ pricingIds, arena, decisions, usedModels });
    return { rows, arena, decisions, latestPublishedAtMs };
  }

  async overview(ref: ExperimentRef): Promise<QualityOverview> {
    const { rows, arena, latestPublishedAtMs } = await this.resolve(ref.organizationId, [ref.scope]);
    const updatedAtMs = arena.reduce((max, m) => Math.max(max, m.updatedAtMs), 0);
    const keys = (pick: (row: ModelQualityRow) => boolean) => new Set(rows.filter(pick).map((r) => r.modelKey)).size;
    return {
      source: { ...SOURCE, publishedAt: latestPublishedAtMs ? new Date(latestPublishedAtMs).toISOString() : null, syncedAt: updatedAtMs ? new Date(updatedAtMs).toISOString() : null },
      items: rows.filter((r) => r.state !== "none" || r.inUse),
      counts: { needsReview: keys((r) => r.state === "candidate"), pending: keys(isPending), inUse: keys((r) => r.inUse) },
    };
  }

  /** Los modelos con candidatos sin decidir, con la lista completa de candidatos, los de uso primero. */
  async candidates(ref: ExperimentRef, scope: "in_use" | "all"): Promise<CandidateGroup[]> {
    const { rows, arena, decisions } = await this.resolve(ref.organizationId, [ref.scope]);
    const groups = new Map<string, CandidateGroup>();
    for (const row of rows) {
      if (row.state !== "candidate" || (scope === "in_use" && !row.inUse)) continue;
      const known = groups.get(row.modelKey);
      if (known) {
        if (row.modelId === row.modelKey || (known.model !== known.modelKey && row.modelId.length < known.model.length)) known.model = row.modelId;
        continue;
      }
      const rejected = new Set(decisions.filter((d) => d.modelKey === row.modelKey && d.decision === "rejected").map((d) => d.arenaModelName));
      groups.set(row.modelKey, { modelKey: row.modelKey, model: row.modelId, inUse: row.inUse, candidates: candidatesFor(row.modelKey, arena, rejected) });
    }
    return [...groups.values()].sort((a, b) => Number(b.inUse) - Number(a.inUse) || a.modelKey.localeCompare(b.modelKey));
  }

  /** Aplica la decisión de una persona sobre una clave del catálogo y la deja en la auditoría. */
  async decide(ref: ExperimentRef & { experimentId: string }, actor: Actor, key: string, change: MatchChange): Promise<void> {
    const { arena, pricingIds } = await this.catalogs();
    const modelKey = keyOf(key);
    if (!modelKey || !pricingIds.some((id) => keyOf(id) === modelKey)) throw new ValidationError("Unknown model", { modelKey: "This model is not in the price catalog" });
    const known = new Set(arena.map((m) => m.modelName));
    const unknown = (names: string[]) => names.find((n) => !known.has(n));
    if (change.decision === "confirm") {
      if (unknown([change.arenaName])) throw new ValidationError("Unknown Arena entry", { arenaName: "Arena does not list this model" });
      await this.decisions.confirm(ref.organizationId, modelKey, change.arenaName, actor.userId);
    } else if (change.decision === "reject") {
      const names = [...new Set(change.arenaNames)];
      if (names.length === 0 || names.length > 50 || unknown(names)) throw new ValidationError("Unknown Arena entry", { arenaNames: "Pick between 1 and 50 entries that Arena lists" });
      await this.decisions.reject(ref.organizationId, modelKey, names, actor.userId);
    } else {
      await this.decisions.setNoEquivalent(ref.organizationId, modelKey, actor.userId);
    }
    await this.record(ref, actor, modelKey, { decision: change.decision, ...(change.decision === "confirm" ? { arenaName: change.arenaName } : {}) });
  }

  /** Quita todas las decisiones de la clave: vuelve a lo automático. `false` si no había ninguna. */
  async clear(ref: ExperimentRef & { experimentId: string }, actor: Actor, key: string): Promise<boolean> {
    const modelKey = keyOf(key);
    if (!modelKey) throw new ValidationError("Unknown model", { modelKey: "This model is not in the price catalog" });
    const cleared = await this.decisions.clear(ref.organizationId, modelKey);
    if (cleared) await this.record(ref, actor, modelKey, { decision: "clear" });
    return cleared;
  }

  /**
   * Modelos en uso que esperan decisión, para la campana. `experiments` son solo los que la persona puede gestionar. Estado vivo, no
   * evento (ADR-094): desaparece al decidir, y no hay tabla ni marca de leído.
   */
  async pending(experiments: Array<ExperimentRef & { experimentId: string }>): Promise<{ total: number; items: PendingItem[] }> {
    const byOrg = new Map<string, Array<ExperimentRef & { experimentId: string }>>();
    for (const e of experiments) byOrg.set(e.organizationId, [...(byOrg.get(e.organizationId) ?? []), e]);
    const items: PendingItem[] = [];
    for (const [organizationId, list] of byOrg) {
      const { rows } = await this.resolve(organizationId, list.map((e) => e.scope));
      const seen = new Set<string>();
      for (const row of rows.filter(isPending)) {
        if (seen.has(row.modelKey)) continue;
        seen.add(row.modelKey);
        items.push({ experimentId: list[0]!.experimentId, modelKey: row.modelKey, model: row.modelKey, candidateCount: row.candidateCount });
      }
    }
    return { total: items.length, items: items.sort((a, b) => a.modelKey.localeCompare(b.modelKey)).slice(0, 20) };
  }

  private record(ref: { organizationId: string; experimentId: string }, actor: Actor, modelKey: string, metadata: Record<string, unknown>) {
    return this.audit.record({
      organizationId: ref.organizationId,
      experimentId: ref.experimentId,
      actorUserId: actor.userId,
      actorLabel: actor.email,
      action: "model_match.update",
      targetType: "model",
      targetId: modelKey,
      metadata,
    });
  }
}
