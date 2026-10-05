import type { AssistantRegistryService } from "@/application/assistant-registry-service";
import type { HealthProber } from "@/application/ports/health-prober";
import type { HealthStatus } from "@/domain/assistant-registry";

export interface ProbeRunSummary {
  probed: number;
  /** despliegues cuyo estado cambió, con el estado anterior y el nuevo */
  changes: Array<{ deploymentId: string; from: HealthStatus; to: HealthStatus }>;
  pruned: number | null;
}

export interface ProbeRunOptions {
  /** máximo de despliegues por ejecución (el resto, en la siguiente) */
  limit?: number;
  /** sondeos a la vez */
  concurrency?: number;
  now?: Date;
}

/** Hora (UTC) a la que se purga el historial: una vez al día, en la ejecución del minuto 0 de esa hora. */
export const PRUNE_HOUR_UTC = 3;

export function shouldPrune(now: Date): boolean {
  return now.getUTCHours() === PRUNE_HOUR_UTC && now.getUTCMinutes() === 0;
}

/**
 * Una pasada del worker de /health (ADR-053): sondea los despliegues que tocan, guarda cada resultado y, una vez al día,
 * purga el historial antiguo. Un fallo de un despliegue no detiene a los demás.
 */
export async function runHealthProbes(registry: AssistantRegistryService, prober: HealthProber, options: ProbeRunOptions = {}): Promise<ProbeRunSummary> {
  const { limit = 200, concurrency = 10, now = new Date() } = options;
  const targets = await registry.dueProbes(limit);
  const changes: ProbeRunSummary["changes"] = [];
  let next = 0;

  async function worker() {
    for (let target = targets[next++]; target; target = targets[next++]) {
      try {
        const result = await prober.probe(target.url);
        const change = await registry.recordProbe(target.deploymentId, result);
        if (change && change.previous !== change.current) changes.push({ deploymentId: target.deploymentId, from: change.previous, to: change.current });
      } catch (error) {
        console.error(`[health-probe] ${target.deploymentId}:`, error);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));

  const pruned = shouldPrune(now) ? await registry.pruneHealthHistory() : null;
  return { probed: targets.length, changes, pruned };
}

/** Cada cuántos minutos el worker sincroniza las conexiones observadas (una consulta a ClickHouse por experimento). */
export const OBSERVED_SYNC_EVERY_MINUTES = 10;

export function shouldSyncObserved(now: Date): boolean {
  return now.getUTCMinutes() % OBSERVED_SYNC_EVERY_MINUTES === 0;
}
