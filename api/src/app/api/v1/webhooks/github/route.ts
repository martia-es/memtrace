import { parseWorkflowRunEvent, verifyGithubSignature } from "@/adapters/inbound/http/github-webhook";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getDeploy } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Webhook de GitHub (ADR-064): avisa de cómo va el workflow de despliegue. No usa sesión: se autentica con la firma
 * HMAC del cuerpo (`GITHUB_WEBHOOK_SECRET`). Sin secreto configurado se rechaza todo, no se acepta sin firma.
 */
export async function POST(request: Request) {
  return identityGuard(async () => {
    const secret = process.env.GITHUB_WEBHOOK_SECRET ?? "";
    const raw = await request.text();
    if (!verifyGithubSignature(secret, raw, request.headers.get("x-hub-signature-256"))) return problem(401, "Unauthorized", "Invalid signature");
    if (request.headers.get("x-github-event") !== "workflow_run") return json({ ignored: true });

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return problem(400, "Bad Request", "Invalid JSON");
    }
    const event = parseWorkflowRunEvent(body);
    if (!event) return problem(400, "Bad Request", "Not a workflow_run event");
    const run = await getDeploy().applyWorkflowEvent(event);
    return json({ matched: run !== null, status: run?.status ?? null });
  });
}
