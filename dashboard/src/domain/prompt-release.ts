/**
 * Qué versión corre en cada entorno y cuánto va por detrás de la última. Alimenta el tablero de la lista de prompts
 * y la tira "running" del detalle. Funciones puras: la pantalla solo pinta lo que devuelven.
 */

/** Orden de los entornos habituales; cualquier otro tag va detrás, por orden alfabético. */
export const ENV_ORDER = ["dev", "pre", "pro"] as const;
/** Entorno que se considera producción: el último de la cadena. */
export const PRODUCTION_ENV = "pro";

export function sortEnvironments(keys: string[]): string[] {
  const rank = (k: string) => {
    const i = (ENV_ORDER as readonly string[]).indexOf(k);
    return i === -1 ? ENV_ORDER.length : i;
  };
  return [...keys].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

interface Tagged {
  latestVersion: number;
  /** tag -> versión a la que apunta */
  tags: Record<string, number>;
}

export type ReleaseState = "behind" | "in_sync" | "not_released";

export interface ReleaseStatus {
  state: ReleaseState;
  /** versiones de la última que aún no han llegado a producción; 0 si está al día o no hay producción */
  behindBy: number;
}

export function releaseStatus(prompt: Tagged): ReleaseStatus {
  const live = prompt.tags[PRODUCTION_ENV];
  if (live === undefined) return { state: "not_released", behindBy: 0 };
  const behindBy = Math.max(0, prompt.latestVersion - live);
  return { state: behindBy === 0 ? "in_sync" : "behind", behindBy };
}

export interface EnvironmentCoverage {
  env: string;
  /** prompts que tienen ese tag puesto */
  pinned: number;
  total: number;
}

export function environmentCoverage(prompts: Tagged[], envs: readonly string[] = ENV_ORDER): EnvironmentCoverage[] {
  return envs.map((env) => ({ env, pinned: prompts.filter((p) => p.tags[env] !== undefined).length, total: prompts.length }));
}

export interface ReleaseSummary {
  behind: number;
  inSync: number;
  notReleased: number;
  /** suma de versiones pendientes de llegar a producción, en todos los prompts */
  waitingVersions: number;
}

export function releaseSummary(prompts: Tagged[]): ReleaseSummary {
  const summary: ReleaseSummary = { behind: 0, inSync: 0, notReleased: 0, waitingVersions: 0 };
  for (const p of prompts) {
    const s = releaseStatus(p);
    if (s.state === "behind") {
      summary.behind += 1;
      summary.waitingVersions += s.behindBy;
    } else if (s.state === "in_sync") summary.inSync += 1;
    else summary.notReleased += 1;
  }
  return summary;
}

export interface TimelineCell {
  version: number;
  /** tags que apuntan a esta versión, en orden de entorno */
  tags: string[];
  /** la versión está por delante de producción: aún no se ha liberado */
  ahead: boolean;
  latest: boolean;
}

/** Las últimas `window` versiones con los tags que cuelgan de cada una; `older` = cuántas quedan fuera por la izquierda. */
export function timelineCells(prompt: Tagged, window = 9): { cells: TimelineCell[]; older: number } {
  const first = Math.max(1, prompt.latestVersion - window + 1);
  const live = prompt.tags[PRODUCTION_ENV];
  const cells: TimelineCell[] = [];
  for (let version = first; version <= prompt.latestVersion; version += 1) {
    const tags = sortEnvironments(Object.keys(prompt.tags).filter((t) => prompt.tags[t] === version));
    cells.push({ version, tags, ahead: live !== undefined && version > live, latest: version === prompt.latestVersion });
  }
  return { cells, older: first - 1 };
}

export interface VersionGroup<T> {
  key: string;
  label: string;
  items: T[];
}

/** Agrupa versiones (ya ordenadas de nueva a vieja) por mes de creación, para que una lista larga se pueda recorrer. */
export function groupByMonth<T extends { createdAt: string }>(versions: T[]): VersionGroup<T>[] {
  const groups: VersionGroup<T>[] = [];
  for (const item of versions) {
    const date = new Date(item.createdAt);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label: date.toLocaleString("en", { month: "long", year: "numeric" }), items: [item] });
  }
  return groups;
}

/** Filtro de la lista de versiones: por número (`12` o `v12`) o por texto del mensaje. */
export function filterVersions<T extends { version: number; message: string }>(versions: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return versions;
  const asNumber = /^v?(\d+)$/.exec(q);
  return versions.filter((v) => (asNumber ? String(v.version) === asNumber[1] : false) || v.message.toLowerCase().includes(q));
}

export interface TextPart {
  text: string;
  variable: boolean;
}

/** Parte una línea de prompt para resaltar las `{{variables}}`. */
export function splitVariables(line: string): TextPart[] {
  return line
    .split(/(\{\{[^{}]+\}\})/)
    .filter((t) => t !== "")
    .map((text) => ({ text, variable: text.startsWith("{{") }));
}

export interface ServingStatus {
  state: "ok" | "catching-up" | "behind";
  label: string;
}

/**
 * Cómo va lo que sirve un agente respecto a su tag y a la última versión: «catching up» si el tag ya apunta a otra versión que la
 * que corre el agente; «N behind» si es producción y hay versiones más nuevas sin liberar; si no, «up to date».
 */
export function servingStatus(serving: { environment: string; tag: string; version: number }, tagVersions: Record<string, number>, latest: number): ServingStatus {
  const target = serving.tag ? tagVersions[serving.tag] : undefined;
  if (target !== undefined && target !== serving.version) return { state: "catching-up", label: "catching up" };
  if (serving.environment === PRODUCTION_ENV && latest > serving.version) return { state: "behind", label: `${latest - serving.version} behind` };
  return { state: "ok", label: "up to date" };
}
