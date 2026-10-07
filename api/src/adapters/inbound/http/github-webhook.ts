import { createHmac, timingSafeEqual } from "node:crypto";

/** ¿Es auténtico el cuerpo? GitHub firma con HMAC-SHA256 del secreto del webhook (`X-Hub-Signature-256: sha256=<hex>`). */
export function verifyGithubSignature(secret: string, rawBody: string, header: string | null): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface WorkflowRunEvent {
  title: string | null;
  status: string | null;
  conclusion: string | null;
  htmlUrl: string | null;
}

/** Extrae lo que importa de un evento `workflow_run`; null si el cuerpo no tiene esa forma. */
export function parseWorkflowRunEvent(body: unknown): WorkflowRunEvent | null {
  const run = (body as { workflow_run?: Record<string, unknown> } | null)?.workflow_run;
  if (!run || typeof run !== "object") return null;
  const text = (v: unknown): string | null => (typeof v === "string" ? v : null);
  return { title: text(run.display_title) ?? text(run.name), status: text(run.status), conclusion: text(run.conclusion), htmlUrl: text(run.html_url) };
}
