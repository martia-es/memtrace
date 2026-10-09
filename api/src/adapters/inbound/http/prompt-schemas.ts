import { z } from "zod";

/** Cuerpos de las rutas del registro de prompts (ADR-067). Las reglas de negocio (formato del nombre, tags, longitud) las valida el dominio. */

const text = (max: number) => z.string().max(max);

export const createPromptBody = z.object({
  /** `fragment`: texto compartido que otros prompts incluyen (ADR-073) */
  kind: z.enum(["prompt", "fragment"]).default("prompt"),
  name: text(100),
  description: text(2100).default(""),
  /** agentes a los que pertenece; vacío = solo de la organización por ahora */
  experimentIds: z.array(z.string().uuid()).max(100).default([]),
  content: text(120_000),
  message: text(600).default(""),
});

export const updatePromptBody = z
  .object({
    description: text(2100),
    archived: z.boolean(),
    experimentIds: z.array(z.string().uuid()).max(100),
  })
  .partial();

export const saveVersionBody = z.object({
  content: text(120_000),
  message: text(600).default(""),
  /** versión de la que se parte; por defecto, la última publicada */
  parentVersion: z.number().int().min(1).nullable().optional(),
  /** guardar como borrador: se puede probar y evaluar, pero no recibe tags hasta publicarse (ADR-072) */
  draft: z.boolean().default(false),
  /** el fallo que se quería arreglar */
  origin: z
    .object({ traceIds: z.array(z.string().max(40)).max(10).default([]), cause: text(400).nullable().default(null), rationale: text(2100).default("") })
    .nullable()
    .default(null),
});

/** Un borrador propuesto por una herramienta del equipo con la API key del agente (ADR-072). */
export const draftBody = z.object({
  name: text(100),
  content: text(120_000),
  message: text(600).default(""),
  /** versión de la que se partió; por defecto, la última publicada */
  basedOn: z.number().int().min(1).nullable().default(null),
  origin: z.object({ traceIds: z.array(z.string().max(40)).max(10).default([]), cause: text(400).nullable().default(null), rationale: text(2100).default("") }).default({ traceIds: [], cause: null, rationale: "" }),
});

export const moveTagBody = z.object({
  /** null quita el tag */
  version: z.number().int().min(1).nullable(),
  reason: text(600).default(""),
  /** solo para saltarse el gate de promoción (ADR-070): exige permiso de gobernanza; el motivo queda en el historial */
  bypassReason: text(600).nullable().default(null),
});

/** Política de promoción (ADR-070): el dataset contra el que se evalúa y cuántos runs seguidos deben pasar. */
export const policyBody = z.object({
  datasetId: z.string().uuid(),
  requiredRuns: z.number().int().min(1).max(10).default(1),
});

/** Query de la vista previa del gate: a qué tag y a qué versión se quiere mover. */
export const gateQuery = z.object({
  tag: z.string().min(1).max(40),
  version: z.coerce.number().int().min(1),
});

/** Query del SDK para pedir un prompt (ADR-068): el nombre y exactamente uno de tag o version. */
export const resolvePromptQuery = z
  .object({
    name: z.string().min(1).max(100),
    tag: z.string().min(1).max(40).optional(),
    version: z.coerce.number().int().min(1).optional(),
    /** token de un override del playground (ADR-071), en lugar de un tag o una versión */
    override: z.string().min(10).max(200).optional(),
  })
  .refine((q) => [q.tag, q.version, q.override].filter((v) => v !== undefined).length === 1, { message: "Send exactly one of tag, version or override", path: ["tag"] });

/** Latido del SDK: qué versiones está usando el agente (ADR-068). */
export const usageReportBody = z.object({
  environment: z.string().max(40).nullable().default(null),
  items: z
    .array(z.object({ name: z.string().min(1).max(100), tag: z.string().min(1).max(40).nullable().default(null), version: z.number().int().min(1) }))
    .max(50),
});

/** Una ejecución del playground: qué versión probar, en qué despliegue (no de producción) y con qué mensaje (ADR-071). */
export const playgroundBody = z.object({
  deploymentId: z.string().uuid(),
  version: z.number().int().min(1),
  message: z.string().max(5000),
});
