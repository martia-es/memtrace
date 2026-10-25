import type { AlertMetricSource } from "@/application/ports/alert-metric-source";
import type { UserFeedbackRepository } from "@/application/ports/user-feedback-repository";
import type { ScoreRepository } from "@/application/ports/score-repository";
import type { SecurityEventRepository } from "@/application/ports/security-event-repository";
import type { IdentityRepository } from "@/application/ports/identity-repository";
import type { TraceQueryService } from "@/application/trace-query-service";
import type { AlertRule, Sample } from "@/domain/alert";
import { matchesTarget, runScore } from "@/domain/alert-evaluation";
import type { CustomMetricDefinition } from "@/domain/metrics";
import type { TenantScope } from "@/domain/tenant";

type Overview = Awaited<ReturnType<TraceQueryService["getOverview"]>>;
const MIN_MS = 60_000;
const DAY_MS = 86_400_000;

/** Lo que hace falta para medir las reglas de seguridad y de evaluación; sin esto esas reglas no tienen valor. */
export interface AlertExtraSources {
  security: Pick<SecurityEventRepository, "countInWindow">;
  runs: Pick<IdentityRepository, "listRunsForExperiment">;
  scores: Pick<ScoreRepository, "listScoresByRun">;
}

/**
 * Mide las reglas con lo que el dashboard ya calcula (ADR-086): el resumen del Overview para tasa de error, latencia y coste, el
 * resumen de votos para la satisfacción y la consulta de la gráfica guardada para las reglas `custom`. El resumen de un servicio y
 * una ventana se pide una sola vez por pasada aunque varias reglas lo necesiten.
 */
export class TraceAlertMetricSource implements AlertMetricSource {
  private overviews = new Map<string, Promise<Overview>>();

  constructor(
    private readonly traces: Pick<TraceQueryService, "getOverview" | "getCustomMetric">,
    private readonly feedback: Pick<UserFeedbackRepository, "summarize">,
    /** la definición de una gráfica guardada, o null si ya no existe */
    private readonly customDefinition: (experimentId: string, metricId: string) => Promise<Record<string, unknown> | null>,
    private readonly extra?: AlertExtraSources,
  ) {}

  reset(): void {
    this.overviews = new Map();
  }

  private overview(scope: TenantScope, from: Date, to: Date): Promise<Overview> {
    const key = `${scope.experimentId}|${from.getTime()}|${to.getTime()}`;
    let found = this.overviews.get(key);
    if (!found) {
      found = this.traces.getOverview({ scope, from, to });
      this.overviews.set(key, found);
    }
    return found;
  }

  /** Runs completados de un experimento, el más reciente primero, que cumplen el `target` de la regla. */
  private async matchingRuns(experimentId: string, target: string) {
    const runs = await this.extra!.runs.listRunsForExperiment(experimentId);
    return runs
      .filter((r) => r.status === "completed" && matchesTarget(r, target))
      .map((r) => ({ ...r, createdMs: new Date(r.createdAt).getTime() }))
      .sort((a, b) => b.createdMs - a.createdMs);
  }

  private async measureEvaluation(rule: AlertRule, scope: TenantScope, now: Date): Promise<Sample> {
    const target = rule.params.target ?? "";
    const runs = await this.matchingRuns(rule.experimentId, target);
    const latest = runs[0];
    if (!latest) return { value: null, samples: 0 };
    if (rule.metric === "eval_stale") return { value: (now.getTime() - latest.createdMs) / DAY_MS, samples: 0 };

    const score = rule.params.score ?? "";
    const latestScore = runScore(await this.extra!.scores.listScoresByRun(scope, latest.id), score);
    if (rule.params.mode !== "drop") return { value: latestScore.value, samples: latestScore.evaluated };

    // caída: contra el run anterior del mismo dataset y la misma versión del dataset
    const previous = runs.find((r) => r !== latest && r.datasetId === latest.datasetId && r.versionMajor === latest.versionMajor && r.versionMinor === latest.versionMinor);
    if (!previous || latestScore.value === null) return { value: null, samples: 0 };
    const previousScore = runScore(await this.extra!.scores.listScoresByRun(scope, previous.id), score);
    if (previousScore.value === null) return { value: null, samples: 0 };
    return { value: previousScore.value - latestScore.value, samples: Math.min(latestScore.evaluated, previousScore.evaluated) };
  }

  async measure(rule: AlertRule, scope: TenantScope, now: Date): Promise<Sample> {
    if ((rule.metric === "eval_score" || rule.metric === "eval_stale") && this.extra) return this.measureEvaluation(rule, scope, now);
    if ((rule.metric === "security_detections" || rule.metric === "security_blocked") && this.extra) {
      const toMs = Math.floor(now.getTime() / MIN_MS) * MIN_MS;
      const count = await this.extra.security.countInWindow({
        scope, fromMs: toMs - rule.windowMinutes * MIN_MS, toMs, detector: rule.params.detector ?? null, severity: rule.params.severity ?? null, blockedOnly: rule.metric === "security_blocked",
      });
      return { value: count, samples: 0 };
    }

    // las ventanas se alinean al minuto para que reglas con la misma ventana compartan una consulta
    const to = new Date(Math.floor(now.getTime() / MIN_MS) * MIN_MS);
    const from = new Date(to.getTime() - rule.windowMinutes * MIN_MS);

    switch (rule.metric) {
      case "error_rate": {
        const { totals } = await this.overview(scope, from, to);
        return { value: totals.traces > 0 ? totals.errorRate * 100 : null, samples: totals.traces };
      }
      case "latency_p95": {
        const { totals, latencyMs } = await this.overview(scope, from, to);
        return { value: totals.traces > 0 ? latencyMs.p95 : null, samples: totals.traces };
      }
      case "cost": {
        const { totals } = await this.overview(scope, from, to);
        return { value: totals.costUsd, samples: 0 };
      }
      case "satisfaction": {
        const summary = await this.feedback.summarize(scope, from.getTime(), to.getTime());
        return { value: summary.satisfaction, samples: summary.total };
      }
      case "security_detections":
      case "security_blocked":
      case "eval_score":
      case "eval_stale":
        return { value: null, samples: 0 }; // sin las fuentes extra no hay de dónde medirlas
      case "custom": {
        if (!rule.customMetricId) return { value: null, samples: 0 }; // la gráfica se borró
        const stored = await this.customDefinition(rule.experimentId, rule.customMetricId);
        if (!stored) return { value: null, samples: 0 };
        const definition = stored as unknown as CustomMetricDefinition;
        // un solo número: sin desglose y como barras, que devuelven un punto por paso
        const result = await this.traces.getCustomMetric({ ...definition, chartType: "bar", groupByAttribute: null, from, to, scope });
        const point = result.points[0];
        // un conteo sin spans es un cero real («ninguna llamada»); cualquier otra métrica sin spans no tiene valor
        if (!point) return { value: definition.metric === "count" ? 0 : null, samples: 0 };
        return { value: point.value, samples: 0 };
      }
    }
  }

  async cost(scope: TenantScope, from: Date, to: Date): Promise<number> {
    if (!(from.getTime() < to.getTime())) return 0;
    const { totals } = await this.traces.getOverview({ scope, from, to });
    return totals.costUsd;
  }
}
