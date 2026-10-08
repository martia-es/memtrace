import { z } from "zod";

/** Cuerpos de las rutas del registro de prompts (ADR-067). Las reglas de negocio (formato del nombre, tags, longitud) las valida el dominio. */

const text = (max: number) => z.string().max(max);

export const createPromptBody = z.object({
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
  /** versión de la que se parte; por defecto, la última */
  parentVersion: z.number().int().min(1).nullable().optional(),
});

export const moveTagBody = z.object({
  /** null quita el tag */
  version: z.number().int().min(1).nullable(),
  reason: text(600).default(""),
});

/** Query del SDK para pedir un prompt (ADR-068): el nombre y exactamente uno de tag o version. */
export const resolvePromptQuery = z
  .object({
    name: z.string().min(1).max(100),
    tag: z.string().min(1).max(40).optional(),
    version: z.coerce.number().int().min(1).optional(),
  })
  .refine((q) => (q.tag === undefined) !== (q.version === undefined), { message: "Send exactly one of tag or version", path: ["tag"] });

/** Latido del SDK: qué versiones está usando el agente (ADR-068). */
export const usageReportBody = z.object({
  environment: z.string().max(40).nullable().default(null),
  items: z
    .array(z.object({ name: z.string().min(1).max(100), tag: z.string().min(1).max(40).nullable().default(null), version: z.number().int().min(1) }))
    .max(50),
});
