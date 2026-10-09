import { requirePromptPermission, requireUser } from "@/adapters/inbound/http/auth-context";
import { getApprovals } from "@/dependency-container";
import type { ApprovalRequest } from "@/domain/approval";
import type { User } from "@/domain/identity";
import type { Prompt } from "@/domain/prompt";

/**
 * Sesión + acceso de lectura al prompt de la solicitud (ADR-076). Quién puede decidir, ejecutar o cancelar lo comprueba el
 * servicio con la regla; aquí solo se exige poder ver el prompt. Sin sesión, 401 antes de saber si la solicitud existe.
 */
export async function requireApprovalAccess(requestId: string): Promise<{ user: User; prompt: Prompt; request: ApprovalRequest } | Response> {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { request, prompt } = await getApprovals().get(requestId);
  const ctx = await requirePromptPermission(prompt.id, "prompt:read");
  if (ctx instanceof Response) return ctx;
  return { user, prompt, request };
}
