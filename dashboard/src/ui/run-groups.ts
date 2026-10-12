import type { RunListItemDto, ScoreAggregateDto } from "@contract";

/**
 * Un run lanzado con `repeats=N` son N ejecuciones (ADR-097) que la API devuelve como N runs sueltos. En las listas se muestran como
 * una fila: la primera ejecución con la media de todas. `executions` es cuántas hay; 1 = run normal.
 */
export type GroupedRun = RunListItemDto & { executions: number; /** ejecuciones que prometió `repeats`, aunque falten por subir */ expected: number };

function meanAggregates(executions: RunListItemDto[]): ScoreAggregateDto[] {
  const byName = new Map<string, ScoreAggregateDto[]>();
  for (const e of executions) {
    if (e.status !== "completed") continue;
    for (const a of e.aggregates) byName.set(`${a.name}\u0000${a.dataType}`, [...(byName.get(`${a.name}\u0000${a.dataType}`) ?? []), a]);
  }
  const mean = (values: Array<number | null>): number | null => {
    const present = values.filter((v): v is number => v !== null);
    return present.length ? present.reduce((x, y) => x + y, 0) / present.length : null;
  };
  return [...byName.values()].map((list) => ({
    name: list[0]!.name,
    dataType: list[0]!.dataType,
    passRate: mean(list.map((a) => a.passRate)),
    average: mean(list.map((a) => a.average)),
    count: Math.round(list.reduce((n, a) => n + a.count, 0) / list.length),
    judges: list.flatMap((a) => a.judges).filter((j, i, all) => all.findIndex((k) => k.model === j.model && k.promptHash === j.promptHash) === i),
  }));
}

/** Una fila por run: las ejecuciones de un mismo grupo se funden en la primera, en el sitio donde aparece la más reciente. */
export function groupRuns(runs: RunListItemDto[]): GroupedRun[] {
  const members = new Map<string, RunListItemDto[]>();
  for (const r of runs) if (r.runGroup) members.set(r.runGroup.id, [...(members.get(r.runGroup.id) ?? []), r]);

  const out: GroupedRun[] = [];
  const done = new Set<string>();
  for (const r of runs) {
    if (!r.runGroup) { out.push({ ...r, executions: 1, expected: 1 }); continue; }
    if (done.has(r.runGroup.id)) continue;
    done.add(r.runGroup.id);
    const all = (members.get(r.runGroup.id) ?? []).slice().sort((a, b) => a.runGroup!.index - b.runGroup!.index);
    const first = all[0]!;
    out.push({
      ...first,
      createdAt: all.reduce((newest, e) => (e.createdAt > newest ? e.createdAt : newest), first.createdAt),
      status: all.length === r.runGroup.total && all.every((e) => e.status === "completed") ? "completed" : "running",
      aggregates: meanAggregates(all),
      executions: all.length,
      expected: r.runGroup.total,
    });
  }
  return out;
}
