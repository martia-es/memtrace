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

export const createPartnershipBody = z.object({ partnerOrganizationId: z.string().uuid() });

export const partnerGrantBody = z.object({
  email: z.string().trim().email(),
  role: z.string().trim().min(1).max(64),
  /** null = todos los experimentos de la organización */
  experimentId: z.string().uuid().nullable().default(null),
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
