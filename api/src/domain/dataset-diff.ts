import { isDeepStrictEqual } from "node:util";
import type { DatasetItem } from "./identity";

/** Un cambio de un item entre dos versiones de un dataset, emparejado por `originItemId` (ADR-033).
 * `removed.after` es el tombstone cuando el borrado ocurrió en la versión destino (trae quién y cuándo). */
export interface DatasetItemChange {
  originItemId: string;
  kind: "added" | "modified" | "removed";
  before: DatasetItem | null;
  after: DatasetItem | null;
}

export interface DatasetVersionDiff {
  changes: DatasetItemChange[];
  unchangedCount: number;
}

function activeByOrigin(items: DatasetItem[]): Map<string, DatasetItem> {
  return new Map(items.filter((item) => !item.deletedAt).map((item) => [item.originItemId, item]));
}

function sameContent(a: DatasetItem, b: DatasetItem): boolean {
  return isDeepStrictEqual(a.input, b.input) && isDeepStrictEqual(a.expectedOutput, b.expectedOutput) && isDeepStrictEqual(a.metadata, b.metadata);
}

/** Diff de `baseItems` (versión de referencia, vacía si no hay anterior) a `targetItems`. Ambas
 * listas pueden incluir tombstones: se ignoran como estado, solo se usan para atribuir borrados.
 * Funciona entre versiones no adyacentes: lo que se añadió y borró entremedias no aparece. */
export function diffDatasetVersions(baseItems: DatasetItem[], targetItems: DatasetItem[]): DatasetVersionDiff {
  const base = activeByOrigin(baseItems);
  const target = activeByOrigin(targetItems);
  const tombstones = new Map(targetItems.filter((item) => item.deletedAt).map((item) => [item.originItemId, item]));
  const changes: DatasetItemChange[] = [];
  let unchangedCount = 0;

  for (const [originItemId, after] of target) {
    const before = base.get(originItemId);
    if (!before) changes.push({ originItemId, kind: "added", before: null, after });
    else if (!sameContent(before, after)) changes.push({ originItemId, kind: "modified", before, after });
    else unchangedCount += 1;
  }
  for (const [originItemId, before] of base) {
    if (!target.has(originItemId)) changes.push({ originItemId, kind: "removed", before, after: tombstones.get(originItemId) ?? null });
  }
  return { changes, unchangedCount };
}

export interface DatasetVersionChangeCounts {
  itemCount: number;
  addedCount: number;
  modifiedCount: number;
  removedCount: number;
}

/** Conteos por versión frente a su anterior. `versionsNewestFirst` es el orden de `listDatasetVersions`;
 * la última (la más antigua) se compara contra vacío, así que no cuenta cambios (es la versión inicial). */
export function countChangesPerVersion(versionsNewestFirst: Array<{ id: string }>, allItems: DatasetItem[]): Map<string, DatasetVersionChangeCounts> {
  const itemsByVersion = new Map<string, DatasetItem[]>();
  for (const item of allItems) {
    const list = itemsByVersion.get(item.datasetVersionId);
    if (list) list.push(item);
    else itemsByVersion.set(item.datasetVersionId, [item]);
  }
  const counts = new Map<string, DatasetVersionChangeCounts>();
  versionsNewestFirst.forEach((version, index) => {
    const items = itemsByVersion.get(version.id) ?? [];
    const itemCount = items.filter((i) => !i.deletedAt).length;
    const previous = versionsNewestFirst[index + 1];
    if (!previous) return void counts.set(version.id, { itemCount, addedCount: 0, modifiedCount: 0, removedCount: 0 });
    const { changes } = diffDatasetVersions(itemsByVersion.get(previous.id) ?? [], items);
    counts.set(version.id, {
      itemCount,
      addedCount: changes.filter((c) => c.kind === "added").length,
      modifiedCount: changes.filter((c) => c.kind === "modified").length,
      removedCount: changes.filter((c) => c.kind === "removed").length,
    });
  });
  return counts;
}
