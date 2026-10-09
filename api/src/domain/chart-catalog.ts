import { ValidationError } from "./errors";

/**
 * Catálogo de datos de las Custom charts (ADR-078): los nombres de negocio y la visibilidad de los pasos y atributos de un
 * experimento. Solo existen las ediciones; lo que hay en las trazas se descubre en vivo. La clave es siempre la técnica.
 */

export const CATALOG_KINDS = ["step", "attribute"] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

export const VISIBILITIES = ["auto", "shown", "hidden"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const MAX_KEY = 300;
export const MAX_NAME = 80;
/** Tope de ediciones por experimento: el catálogo es una capa de nombres, no un almacén. */
export const MAX_ENTRIES = 500;

export interface CatalogEntry {
  kind: CatalogKind;
  key: string;
  /** null = sin nombre propio: vale el del diccionario o el humanizado */
  displayName: string | null;
  visibility: Visibility;
  updatedBy: string | null;
  updatedAt: string;
}

export function validateKind(raw: unknown): CatalogKind {
  if (!CATALOG_KINDS.includes(raw as CatalogKind)) throw new ValidationError("Invalid catalog entry", { kind: `Use one of: ${CATALOG_KINDS.join(", ")}` });
  return raw as CatalogKind;
}

export function validateKey(raw: unknown): string {
  const key = typeof raw === "string" ? raw.trim() : "";
  if (key.length === 0 || key.length > MAX_KEY) throw new ValidationError("Invalid catalog entry", { key: `A key of 1 to ${MAX_KEY} characters` });
  return key;
}

/** Un nombre en blanco o ausente es "sin nombre propio" (null). Los espacios repetidos se juntan; sin saltos de línea ni controles. */
export function validateDisplayName(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") throw new ValidationError("Invalid name", { displayName: "A name is text" });
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) throw new ValidationError("Invalid name", { displayName: "A name has no line breaks or control characters" });
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length === 0) return null;
  if (name.length > MAX_NAME) throw new ValidationError("The name is too long", { displayName: `At most ${MAX_NAME} characters` });
  return name;
}

export function validateVisibility(raw: unknown): Visibility {
  if (raw === undefined || raw === null) return "auto";
  if (!VISIBILITIES.includes(raw as Visibility)) throw new ValidationError("Invalid visibility", { visibility: `Use one of: ${VISIBILITIES.join(", ")}` });
  return raw as Visibility;
}

/** Una edición que no dice nada (sin nombre y en automático) no se guarda: volver a automático la borra. */
export function isEmptyEdit(displayName: string | null, visibility: Visibility): boolean {
  return displayName === null && visibility === "auto";
}

/** Otra entrada del mismo tipo que ya usa ese nombre (sin mirar mayúsculas): dos opciones con el mismo nombre confunden. */
export function nameClash(entries: readonly CatalogEntry[], kind: CatalogKind, key: string, name: string): CatalogEntry | null {
  const wanted = name.toLocaleLowerCase();
  return entries.find((e) => e.kind === kind && e.key !== key && e.displayName?.toLocaleLowerCase() === wanted) ?? null;
}
