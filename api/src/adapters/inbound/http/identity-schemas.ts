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

export const organizationThemeBody = z.object({
  accentColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i, "Must be a hex color like #1c1f23")
    .nullable(),
  radiusPreset: z.enum(["sharp", "soft", "round"]).nullable(),
});

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
