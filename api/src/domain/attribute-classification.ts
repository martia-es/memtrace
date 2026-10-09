/**
 * Clasificación automática de los atributos de los spans (ADR-078, fase 2). Una función pura sobre estadísticas que calcula
 * ClickHouse: decide si un atributo sirve para agrupar o filtrar una gráfica (una categoría), si es una medida (un número) o si
 * solo estorba en un selector (un id, un texto libre, un detalle técnico). Reglas deterministas, sin IA; todos los umbrales están
 * aquí, en un solo sitio.
 */

export type AttributeKind = "category" | "number" | "id" | "text" | "technical";

/** Lo que se mide de un atributo en un rango y unos pasos. Los valores vacíos no cuentan para nada salvo `count`. */
export interface AttributeStats {
  key: string;
  /** spans donde aparece la clave */
  count: number;
  /** de esos, los que traen valor */
  nonEmpty: number;
  /** valores distintos (aproximado: basta para clasificar) */
  distinct: number;
  /** valores que son un número finito */
  numericCount: number;
  /** longitud media de los valores, en caracteres */
  avgLength: number;
  /** valores con forma de identificador: uuid, hash largo o número muy largo */
  idLikeCount: number;
}

export interface AttributeClassification {
  kind: AttributeKind;
  /** casi todos sus valores son números: sirve como medida (fase 3), aunque también sea una categoría (una nota del 1 al 5) */
  numeric: boolean;
  /** los selectores de agrupar y filtrar lo ocultan salvo que una persona lo muestre */
  hiddenByDefault: boolean;
}

/** Con menos valores que esto no hay evidencia para tratar algo como un id por su variedad. */
export const MIN_ROWS_FOR_UNIQUENESS = 20;
/** Un valor casi siempre distinto en cada span no agrupa nada: es un identificador. */
export const ID_UNIQUE_RATIO = 0.8;
/** Share de valores con forma de id a partir del cual el atributo se trata como un id. */
export const ID_LIKE_SHARE = 0.8;
/** Share de valores numéricos a partir del cual el atributo es numérico. */
export const NUMERIC_SHARE = 0.95;
/** Una medida con pocos valores distintos (una nota del 1 al 5) se agrupa mejor como categoría. */
export const NUMBER_AS_CATEGORY_MAX_DISTINCT = 20;
/** Longitud media a partir de la cual un valor es un texto libre (un mensaje, un prompt), no una etiqueta. */
export const TEXT_AVG_LENGTH = 60;
/** Más valores distintos que esto no caben en una gráfica de barras ni en una lista para filtrar. */
export const CATEGORY_MAX_DISTINCT = 200;

/** Fontanería de instrumentación: se oculta salvo que se pida expresamente. Misma lista que usaba el dashboard (ADR-057). */
export const TECHNICAL_ATTRIBUTE = /^(memtrace\.|otel\.|telemetry\.|gen_ai\.(tool\.call\.|usage\.|request\.(temperature|max_tokens|top_p)|prompt|completion|response\.id)|exception\.|code\.|thread\.|process\.)/;

/** `customer_id`, `user.uuid`, `order-guid`, `customerId`: por el nombre ya se sabe que identifica algo. */
export const ID_KEY = /(^|[._-])(id|uuid|guid)$|[a-z0-9]Id$/;

/**
 * Misma forma que usa la consulta de ClickHouse para contar `idLikeCount`: un uuid, un hash o identificador hexadecimal de 24 o más
 * caracteres, o un número de 12 o más cifras. No se incluyen palabras largas: `get_air_quality_forecast` es un nombre, no un id.
 */
export const ID_LIKE_VALUE_PATTERN = "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{24,}|[0-9]{12,})$";

const share = (part: number, whole: number): number => (whole > 0 ? part / whole : 0);

export function isTechnicalAttribute(key: string): boolean {
  return TECHNICAL_ATTRIBUTE.test(key);
}

/** Qué tipo de atributo es y qué se debe hacer con él en los selectores. */
export function classifyAttribute(stats: AttributeStats): AttributeClassification {
  const numeric = stats.nonEmpty > 0 && share(stats.numericCount, stats.nonEmpty) >= NUMERIC_SHARE;
  const result = (kind: AttributeKind): AttributeClassification => ({ kind, numeric, hiddenByDefault: kind === "id" || kind === "text" || kind === "technical" });

  if (isTechnicalAttribute(stats.key)) return result("technical");
  if (ID_KEY.test(stats.key)) return result("id");
  if (share(stats.idLikeCount, stats.nonEmpty) >= ID_LIKE_SHARE) return result("id");
  if (numeric) return result(stats.distinct <= NUMBER_AS_CATEGORY_MAX_DISTINCT ? "category" : "number");
  if (stats.avgLength > TEXT_AVG_LENGTH) return result("text");
  if (stats.nonEmpty >= MIN_ROWS_FOR_UNIQUENESS && share(stats.distinct, stats.nonEmpty) >= ID_UNIQUE_RATIO) return result("id");
  if (stats.distinct > CATEGORY_MAX_DISTINCT) return result("id");
  return result("category");
}
