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
