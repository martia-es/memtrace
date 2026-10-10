import { z } from "zod";
import { ValidationError } from "@/domain/errors";

export const createOrganizationBody = z.object({ name: z.string().trim().min(1).max(200) });

export const createExperimentBody = z.object({
  name: z.string().trim().min(1).max(200),
  serviceName: z.string().trim().min(1).max(200),
  /** ficha del agente (ADR-054): todo opcional; el dueño es quien lo crea */
  description: z.string().trim().max(2000).default(""),
});

export const addMemberBody = z.object({
  email: z.string().trim().email(),
  role: z.string().trim().min(1).max(64),
});

export const identityClaimBody = z.object({ groupsClaim: z.string().trim().min(1).max(200) });

export const mappingBody = z.object({
  externalGroup: z.string().trim().min(1).max(500),
  experimentId: z.string().uuid().nullable(),
  role: z.string().trim().min(1).max(64),
});

export const addOrgAdminBody = z.object({
  email: z.string().trim().email(),
});

const hexColor = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i, "Must be a hex color like #1c1f23")
  .nullable();
const displayMode = z.enum(["bubble", "dock", "fullscreen"]);

export const organizationThemeBody = z
  .object({
    accentColor: hexColor,
    radiusPreset: z.enum(["sharp", "soft", "round"]).nullable(),
    secondaryColor: hexColor.default(null),
    fontPreset: z.enum(["system", "serif", "humanist"]).nullable().default(null),
    assistantName: z.string().trim().max(40).nullable().default(null),
    assistantDefaultMode: displayMode.nullable().default(null),
    assistantAllowedModes: z.array(displayMode).min(1).nullable().default(null),
  })
  .refine((t) => !t.assistantDefaultMode || !t.assistantAllowedModes || t.assistantAllowedModes.includes(t.assistantDefaultMode), {
    message: "The default assistant mode must be one of the allowed modes",
    path: ["assistantDefaultMode"],
  });

/** Valida la query string de la petición; un parámetro inválido es un 400 con el motivo por campo, no un 500. */
export function parseQueryOrThrow<T>(schema: z.ZodType<T>, request: Request): T {
  const result = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) fields[issue.path.join(".") || "_"] = issue.message;
    throw new ValidationError("Invalid query parameters", fields);
  }
  return result.data;
}

export async function parseJsonOrThrow<T>(schema: z.ZodType<T>, request: Request): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("Invalid JSON body");
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) fields[issue.path.join(".") || "_"] = issue.message;
    throw new ValidationError("Invalid request body", fields);
  }
  return result.data;
}

/** Un objeto JSON cualquiera: el dominio valida los campos y dice cuál falla (ADR-086). */
export const looseObjectBody = z.record(z.string(), z.unknown());

/** Plazo de retención de la organización (ADR-084). El rango lo valida el dominio. */
export const organizationRetentionBody = z.object({ days: z.number() });

/** Plazo propio de un experimento; `null` quita el override y vuelve al de la organización (ADR-084). */
export const experimentRetentionBody = z.object({ days: z.number().nullable() });
