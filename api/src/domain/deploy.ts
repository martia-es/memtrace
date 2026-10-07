import { ValidationError } from "./errors";
import type { RepoConfig } from "./assistant-registry";

/**
 * Despliegues lanzados desde MemTrace (ADR-064). MemTrace no despliega: dispara el CI del repositorio del agente y
 * registra qué pidió y cómo acabó. Reglas puras, sin tecnología.
 */

export type DeployStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export const DEPLOY_STATUSES: readonly DeployStatus[] = ["queued", "running", "succeeded", "failed", "cancelled"];
const FINAL: readonly DeployStatus[] = ["succeeded", "failed", "cancelled"];

export const isFinalStatus = (status: DeployStatus): boolean => FINAL.includes(status);

export interface DeployRun {
  id: string;
  deploymentId: string;
  experimentId: string;
  commitSha: string;
  ref: string;
  requestedBy: string | null;
  status: DeployStatus;
  gateVerdict: string;
  gateBypassed: boolean;
  bypassReason: string | null;
  providerRunUrl: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface NewDeployRun {
  deploymentId: string;
  experimentId: string;
  commitSha: string;
  ref: string;
  requestedBy: string;
  gateVerdict: string;
  gateBypassed: boolean;
  bypassReason: string | null;
}

/** Qué hace falta para poder lanzar un despliegue en un entorno: repo, workflow y rama declarados. */
export function missingDeploySetup(repo: RepoConfig | null, deployRef: string | null): string | null {
  if (!repo) return "The agent has no source repository: add it by editing the agent.";
  if (!repo.deployWorkflow) return "The agent has no deploy workflow: add it by editing the agent.";
  if (!deployRef) return "This environment has no branch or tag to deploy: set it by editing the deployment.";
  return null;
}

/** Saltarse el gate (hotfix) exige un motivo escrito: queda en el historial. */
export function validateBypassReason(reason: string | null | undefined): string {
  const value = (reason ?? "").trim();
  if (value.length < 5 || value.length > 500) throw new ValidationError("Invalid bypass reason", { bypassReason: "Explain why in 5 to 500 characters" });
  return value;
}

/** Dueño y nombre de un repositorio de GitHub a partir de su URL; null si no tiene esa forma. */
export function parseGithubRepo(url: string): { owner: string; repo: string } | null {
  try {
    const parts = new URL(url).pathname.replace(/\.git$/, "").split("/").filter(Boolean);
    if (parts.length !== 2) return null;
    const [owner, repo] = parts as [string, string];
    return /^[\w.-]+$/.test(owner) && /^[\w.-]+$/.test(repo) ? { owner, repo } : null;
  } catch {
    return null;
  }
}

/**
 * El workflow se identifica en el `run-name` con este marcador: es lo único que el webhook de GitHub devuelve de lo que
 * lanzamos (los inputs no viajan en el evento), y así el resultado se enlaza con el despliegue que lo pidió.
 */
export const DEPLOY_MARKER_PREFIX = "deploy:";
export const deployMarker = (deployRunId: string): string => `${DEPLOY_MARKER_PREFIX}${deployRunId}`;

export function deployRunIdFromTitle(title: string | null | undefined): string | null {
  const match = /deploy:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(title ?? "");
  return match ? match[1]!.toLowerCase() : null;
}

/** Estado de un `workflow_run` de GitHub (evento `workflow_run`) como estado de despliegue. */
export function statusFromWorkflowRun(status: string | null | undefined, conclusion: string | null | undefined): DeployStatus {
  if (status === "completed") {
    if (conclusion === "success") return "succeeded";
    if (conclusion === "cancelled") return "cancelled";
    return "failed";
  }
  return status === "queued" || status === "waiting" || status === "requested" || status === "pending" ? "queued" : "running";
}
