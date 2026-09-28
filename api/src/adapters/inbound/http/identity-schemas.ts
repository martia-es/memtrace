import { z } from "zod";
import { ValidationError } from "@/domain/errors";

export const createOrganizationBody = z.object({ name: z.string().trim().min(1).max(200) });

export const createExperimentBody = z.object({
  name: z.string().trim().min(1).max(200),
  serviceName: z.string().trim().min(1).max(200),
});

export const addMemberBody = z.object({
  email: z.string().trim().email(),
  role: z.enum(["admin", "member"]),
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
