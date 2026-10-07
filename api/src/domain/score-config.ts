/** Score configs (ADR-036): rúbricas por experimento que declaran qué se puntúa y cómo. Lógica pura, sin I/O. */
import { ScoreConfigInvariantError, ScoreConfigShapeError } from "@/domain/errors";
import type { ScoreDataType } from "@/domain/evaluation";

export interface ScoreConfigCategory {
  label: string;
  /** Valor numérico opcional para agregar categorías ordinales (bad=0, ok=1, good=2). */
  value: number | null;
}

export interface ScoreConfig {
  id: string;
  experimentId: string;
  name: string;
  dataType: ScoreDataType;
  minValue: number | null;
  maxValue: number | null;
  categories: ScoreConfigCategory[] | null;
  /** Solo boolean: objetivo de pass rate (0-1) que usa el dashboard de evaluaciones; null = valor por defecto. */
  targetPassRate: number | null;
  description: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

/** Campos que el usuario elige al crear; el resto los pone el repositorio. */
export interface NewScoreConfig {
  name: string;
  dataType: ScoreDataType;
  minValue: number | null;
  maxValue: number | null;
  categories: ScoreConfigCategory[] | null;
  targetPassRate?: number | null;
  description: string | null;
}

/** Cambios permitidos tras crear (`undefined` = no tocar). `dataType` y `name` no aparecen: son inmutables. */
export interface ScoreConfigPatch {
  description?: string | null;
  minValue?: number;
  maxValue?: number;
  categories?: ScoreConfigCategory[];
  targetPassRate?: number | null;
}

export interface ScoreConfigChanges {
  description: string | null;
  minValue: number | null;
  maxValue: number | null;
  categories: ScoreConfigCategory[] | null;
  targetPassRate: number | null;
}

const NAME_MAX = 200;

/** Normaliza y valida la forma de una config nueva según su `dataType`. Lanza `ScoreConfigShapeError`. */
export function validateNewScoreConfig(input: NewScoreConfig): NewScoreConfig {
  const name = input.name.trim();
  if (name.length === 0 || name.length > NAME_MAX) {
    throw new ScoreConfigShapeError("Invalid score config", { name: `must be 1-${NAME_MAX} characters` });
  }
  const description = input.description?.trim() || null;

  if (input.dataType === "numeric") {
    if (input.categories) throw new ScoreConfigShapeError("Invalid score config", { categories: "only allowed for categorical configs" });
    assertRange(input.minValue, input.maxValue);
    assertNoTarget(input.targetPassRate ?? null);
    return { name, dataType: "numeric", minValue: input.minValue, maxValue: input.maxValue, categories: null, targetPassRate: null, description };
  }
  if (input.minValue !== null || input.maxValue !== null) {
    throw new ScoreConfigShapeError("Invalid score config", { minValue: "only allowed for numeric configs" });
  }
  if (input.dataType === "boolean") {
    if (input.categories) throw new ScoreConfigShapeError("Invalid score config", { categories: "only allowed for categorical configs" });
    const targetPassRate = input.targetPassRate ?? null;
    assertTarget(targetPassRate);
    return { name, dataType: "boolean", minValue: null, maxValue: null, categories: null, targetPassRate, description };
  }
  assertNoTarget(input.targetPassRate ?? null);
  return { name, dataType: "categorical", minValue: null, maxValue: null, categories: normalizeCategories(input.categories), targetPassRate: null, description };
}

/**
 * Aplica un parche respetando las invariantes de ADR-036: el rango solo se amplía y las categorías
 * existentes no se renombran, eliminan ni cambian de valor (solo se pueden añadir). Devuelve el
 * estado resultante; no muta `current`.
 */
export function applyScoreConfigPatch(current: ScoreConfig, patch: ScoreConfigPatch): ScoreConfigChanges {
  if (current.archivedAt) throw new ScoreConfigInvariantError("Archived score configs cannot be edited");
  let { minValue, maxValue, categories, targetPassRate } = current;
  const description = patch.description === undefined ? current.description : patch.description?.trim() || null;

  if (patch.minValue !== undefined || patch.maxValue !== undefined) {
    if (current.dataType !== "numeric") throw new ScoreConfigShapeError("Invalid score config", { minValue: "only allowed for numeric configs" });
    const nextMin = patch.minValue ?? current.minValue!;
    const nextMax = patch.maxValue ?? current.maxValue!;
    assertRange(nextMin, nextMax);
    if (nextMin > current.minValue!) throw new ScoreConfigInvariantError("minValue can only be lowered, not raised");
    if (nextMax < current.maxValue!) throw new ScoreConfigInvariantError("maxValue can only be raised, not lowered");
    minValue = nextMin;
    maxValue = nextMax;
  }

  if (patch.categories !== undefined) {
    if (current.dataType !== "categorical") throw new ScoreConfigShapeError("Invalid score config", { categories: "only allowed for categorical configs" });
    const next = normalizeCategories(patch.categories);
    for (const existing of current.categories ?? []) {
      const kept = next.find((c) => c.label === existing.label);
      if (!kept) throw new ScoreConfigInvariantError(`Category "${existing.label}" cannot be removed or renamed`);
      if (kept.value !== existing.value) throw new ScoreConfigInvariantError(`Category "${existing.label}" cannot change its value`);
    }
    categories = next;
  }

  if (patch.targetPassRate !== undefined) {
    if (current.dataType !== "boolean") throw new ScoreConfigShapeError("Invalid score config", { targetPassRate: "only allowed for boolean configs" });
    assertTarget(patch.targetPassRate);
    targetPassRate = patch.targetPassRate;
  }

  return { description, minValue, maxValue, categories, targetPassRate };
}

function assertTarget(target: number | null): void {
  if (target !== null && !(Number.isFinite(target) && target > 0 && target <= 1)) {
    throw new ScoreConfigShapeError("Invalid score config", { targetPassRate: "must be greater than 0 and at most 1" });
  }
}

function assertNoTarget(target: number | null): void {
  if (target !== null) throw new ScoreConfigShapeError("Invalid score config", { targetPassRate: "only allowed for boolean configs" });
}

function assertRange(min: number | null, max: number | null): asserts min is number {
  if (min === null || max === null) throw new ScoreConfigShapeError("Invalid score config", { minValue: "numeric configs require minValue and maxValue" });
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
    throw new ScoreConfigShapeError("Invalid score config", { minValue: "minValue must be lower than maxValue" });
  }
}

function normalizeCategories(categories: ScoreConfigCategory[] | null): ScoreConfigCategory[] {
  if (!categories || categories.length < 2) {
    throw new ScoreConfigShapeError("Invalid score config", { categories: "categorical configs need at least 2 categories" });
  }
  const seen = new Set<string>();
  return categories.map(({ label, value }) => {
    const trimmed = label.trim();
    if (trimmed.length === 0) throw new ScoreConfigShapeError("Invalid score config", { categories: "category labels cannot be empty" });
    if (seen.has(trimmed)) throw new ScoreConfigShapeError("Invalid score config", { categories: `duplicate category "${trimmed}"` });
    if (value !== null && !Number.isFinite(value)) throw new ScoreConfigShapeError("Invalid score config", { categories: `category "${trimmed}" has a non-finite value` });
    seen.add(trimmed);
    return { label: trimmed, value };
  });
}
