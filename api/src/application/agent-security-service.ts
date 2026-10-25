import type { IdentityRepository } from "@/application/ports/identity-repository";
import type { ScoreRepository } from "@/application/ports/score-repository";
import type { SecurityEventRepository } from "@/application/ports/security-event-repository";
import { MAX_REDTEAM_RUNS, MAX_SECURITY_DAYS, buildSecurityEvents, isRedTeamRun, summarizeRedTeamRun, type SecurityPosture } from "@/domain/agent-security";
import { ValidationError } from "@/domain/errors";
import type { TenantScope } from "@/domain/tenant";

const DAY_MS = 86_400_000;

/**
 * Postura de seguridad de un agente (ADR-103): eventos de los detectores del SDK en producción y los últimos runs de red team.
 * Solo lee. La ruta ya comprobó que se puede ver el agente.
 */
export class AgentSecurityService {
  constructor(
    private readonly identity: IdentityRepository,
    private readonly scores: ScoreRepository,
    private readonly events: SecurityEventRepository,
    private readonly now: () => number = Date.now,
  ) {}

  async posture(scope: TenantScope, input: { days: number }): Promise<SecurityPosture> {
    const { days } = input;
    if (!Number.isInteger(days) || days < 1 || days > MAX_SECURITY_DAYS) {
      throw new ValidationError("Invalid period", { days: `\`days\` must be a whole number between 1 and ${MAX_SECURITY_DAYS}` });
    }
    const nowMs = this.now();
    const [rows, allRuns] = await Promise.all([
      this.events.countEvents({ fromMs: nowMs - days * DAY_MS, toMs: nowMs, scope }),
      this.identity.listRunsForExperiment(scope.experimentId),
    ]);
    const runs = allRuns
      .filter((r) => isRedTeamRun(r.name) && r.status === "completed")
      // pg returns timestamps as Date at runtime even though the type says string
      .map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_REDTEAM_RUNS);
    const summaries = await Promise.all(runs.map(async (run) => summarizeRedTeamRun(run, await this.scores.listScoresByRun(scope, run.id))));
    return { days, events: buildSecurityEvents(rows, days, nowMs), redteam: { runs: summaries } };
  }
}
