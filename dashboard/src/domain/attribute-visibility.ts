import type { AttributeKeyDto } from "@contract";
import { isTechnicalAttribute } from "./custom-chart-vocabulary";

/**
 * Qué atributos ofrecen los selectores de agrupar y filtrar (ADR-078, fase 2). El servidor clasifica cada atributo (categoría, número,
 * id, texto libre, técnico) y dice si se oculta por defecto; la persona puede forzar `shown` o `hidden` en el catálogo. Aquí solo se
 * decide qué se enseña y cómo se explica.
 */

export type Visibility = "auto" | "shown" | "hidden";
export type AttributeKind = AttributeKeyDto["kind"];

/** Un atributo detectado. Los campos de clasificación pueden faltar si responde una API anterior a la fase 2: se cae al nombre. */
export type AttributeInfo = Pick<AttributeKeyDto, "key" | "count"> & Partial<Pick<AttributeKeyDto, "kind" | "distinct" | "numeric" | "hiddenByDefault">>;

export const KIND_LABEL: Record<AttributeKind, string> = {
  category: "Category",
  number: "Number",
  id: "Identifier",
  text: "Free text",
  technical: "Technical",
};

/** Por qué un atributo así no suele servir para agrupar, dicho en llano. */
const KIND_REASON: Partial<Record<AttributeKind, string>> = {
  id: "it is different in almost every step, so a chart would get one bar per value",
  text: "its values are long free texts, not labels",
  technical: "it is instrumentation detail",
};

/** Lo que dice el servidor; sin clasificación, solo se esconden los detalles técnicos por su nombre (como antes de la fase 2). */
export function kindOf(info: AttributeInfo): AttributeKind {
  return info.kind ?? (isTechnicalAttribute(info.key) ? "technical" : "category");
}

export function hiddenByDefault(info: AttributeInfo): boolean {
  return info.hiddenByDefault ?? isTechnicalAttribute(info.key);
}

/** La elección de la persona manda; en automático, lo decide la clasificación. */
export function isAttributeShown(info: AttributeInfo, visibility: Visibility): boolean {
  if (visibility === "shown") return true;
  if (visibility === "hidden") return false;
  return !hiddenByDefault(info);
}

/** "Hidden by you" / "Hidden automatically: it looks like an identifier…" / null si se enseña. */
export function hiddenReason(info: AttributeInfo, visibility: Visibility): string | null {
  if (isAttributeShown(info, visibility)) return null;
  if (visibility === "hidden") return "Hidden by you";
  const why = KIND_REASON[kindOf(info)];
  return why ? `Hidden automatically: ${why}` : "Hidden automatically";
}

/** El texto de la opción "Automatic": dice qué hará la clasificación con este atributo. */
export function automaticLabel(info: AttributeInfo): string {
  return hiddenByDefault(info) ? "Automatic (hidden)" : "Automatic (shown)";
}

/**
 * ¿Sirve como medida de una métrica (total, media, mínimo, máximo)? Casi todos sus valores son números y no es un identificador: sumar
 * ids no significa nada. Los detalles técnicos numéricos (los tokens) sí sirven. Sin clasificación del servidor no se ofrece ninguno.
 */
export function isMeasure(info: AttributeInfo): boolean {
  return info.numeric === true && kindOf(info) !== "id";
}

/** "1 value", "12 different values"; null si no se sabe. */
export function distinctLabel(info: AttributeInfo): string | null {
  if (info.distinct === undefined) return null;
  return `${info.distinct.toLocaleString()} ${info.distinct === 1 ? "value" : "different values"}`;
}
