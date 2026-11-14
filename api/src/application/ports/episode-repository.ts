import type { EpisodeSignals } from "@/domain/uncertainty";
import type { TenantScope } from "@/domain/tenant";

/**
 * Lectura de los episodios que calcula el worker `analytics/mem` (tabla `mem_episodes`, ClickHouse). Solo lectura:
 * la API nunca los escribe. Una traza sin episodio (aún no se cerró o es anterior al worker) no aparece en el mapa.
 */
export interface EpisodeRepository {
  signalsForTraces(scope: TenantScope, traceIds: string[]): Promise<Map<string, EpisodeSignals>>;
}
