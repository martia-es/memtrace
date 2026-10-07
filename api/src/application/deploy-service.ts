import type { AssistantRegistryService } from "@/application/assistant-registry-service";
import type { DeployGateService } from "@/application/deploy-gate-service";
import type { CiDispatcher } from "@/application/ports/ci-dispatcher";
import type { DeployRunRepository } from "@/application/ports/deploy-run-repository";
import type { DeploymentSummary } from "@/domain/assistant-registry";
import { deployMarker, deployRunIdFromTitle, missingDeploySetup, statusFromWorkflowRun, validateBypassReason, type DeployRun } from "@/domain/deploy";
import type { GateResult } from "@/domain/deploy-gate";
import { AssistantInvariantError, AssistantNotFoundError, AssistantUpstreamError, CiUnavailableError, DeployBlockedError } from "@/domain/errors";

export interface DeployPreview {
  ref: string;
  sha: string;
  environment: string;
  gate: GateResult;
}

/**
 * Despliegue desde MemTrace (ADR-064): resuelve la rama a un commit, pasa por el gate de evaluación, dispara el workflow
 * del repo del agente y guarda el resultado. MemTrace no construye ni despliega nada.
 */
export class DeployService {
  constructor(
    private readonly registry: AssistantRegistryService,
    private readonly gate: DeployGateService,
    private readonly runs: DeployRunRepository,
    private readonly dispatcher: CiDispatcher,
  ) {}

  private async context(experimentId: string, deploymentId: string): Promise<{ repo: NonNullable<Awaited<ReturnType<AssistantRegistryService["getCard"]>>["repo"]>; deployment: DeploymentSummary }> {
    const card = await this.registry.getCard(experimentId);
    const deployment = card.deployments.find((d) => d.id === deploymentId);
    if (!deployment) throw new AssistantNotFoundError("Deployment");
    const missing = missingDeploySetup(card.repo, deployment.deployRef);
    if (missing) throw new AssistantInvariantError(missing);
    return { repo: card.repo!, deployment };
  }

  /** Qué se desplegaría y si el gate lo permite, sin lanzar nada. */
  async preview(experimentId: string, deploymentId: string): Promise<DeployPreview> {
    const { repo, deployment } = await this.context(experimentId, deploymentId);
    const ref = deployment.deployRef!;
    const sha = await this.dispatcher.resolveRef(repo, ref);
    return { ref, sha, environment: deployment.environment.key, gate: await this.gate.check(experimentId, sha) };
  }

  async deploy(
    experimentId: string,
    deploymentId: string,
    input: { userId: string; canBypass: boolean; bypassReason?: string | null },
  ): Promise<DeployRun> {
    const { repo, deployment } = await this.context(experimentId, deploymentId);
    if (await this.runs.hasActive(deploymentId)) throw new AssistantInvariantError("There is already a deployment in progress for this environment");

    const ref = deployment.deployRef!;
    const sha = await this.dispatcher.resolveRef(repo, ref);
    const gate = await this.gate.check(experimentId, sha);

    let bypassReason: string | null = null;
    if (!gate.allowed) {
      if (input.bypassReason === undefined || input.bypassReason === null) throw new DeployBlockedError(gate.reason, gate);
      if (!input.canBypass) throw new DeployBlockedError(`${gate.reason} Skipping the evaluation requires the governance permission.`, gate);
      bypassReason = validateBypassReason(input.bypassReason);
    }

    const run = await this.runs.create({
      deploymentId,
      experimentId,
      commitSha: sha,
      ref,
      requestedBy: input.userId,
      gateVerdict: gate.verdict,
      gateBypassed: bypassReason !== null,
      bypassReason,
    });
    try {
      const { runUrl } = await this.dispatcher.dispatch(repo, { ref, sha, environment: deployment.environment.key, marker: deployMarker(run.id) });
      return (await this.runs.setStatus(run.id, "running", { providerRunUrl: runUrl })) ?? run;
    } catch (error) {
      const message = error instanceof Error ? error.message : "dispatch failed";
      await this.runs.setStatus(run.id, "failed", { error: message });
      if (error instanceof CiUnavailableError || error instanceof AssistantUpstreamError) throw error;
      throw new AssistantUpstreamError(message);
    }
  }

  async history(experimentId: string, deploymentId: string, limit = 20): Promise<DeployRun[]> {
    const card = await this.registry.getCard(experimentId);
    if (!card.deployments.some((d) => d.id === deploymentId)) throw new AssistantNotFoundError("Deployment");
    return this.runs.listForDeployment(deploymentId, Math.min(Math.max(limit, 1), 100));
  }

  /** Resultado que avisa el proveedor (webhook `workflow_run`). Ignora lo que no lleva la marca de un despliegue nuestro. */
  async applyWorkflowEvent(event: { title: string | null; status: string | null; conclusion: string | null; htmlUrl: string | null }): Promise<DeployRun | null> {
    const id = deployRunIdFromTitle(event.title);
    if (!id) return null;
    const status = statusFromWorkflowRun(event.status, event.conclusion);
    return this.runs.setStatus(id, status, {
      providerRunUrl: event.htmlUrl,
      error: status === "failed" ? `The workflow finished with "${event.conclusion ?? "failure"}"` : null,
    });
  }
}
