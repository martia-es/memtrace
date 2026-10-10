import type { AlertMetricSource } from "@/application/ports/alert-metric-source";
import type { UserFeedbackRepository } from "@/application/ports/user-feedback-repository";
import type { TraceQueryService } from "@/application/trace-query-service";
import type { AlertRule, Sample } from "@/domain/alert";
import type { CustomMetricDefinition } from "@/domain/metrics";
import type { TenantScope } from "@/domain/tenant";

type Overview = Awaited<ReturnType<TraceQueryService["getOverview"]>>;
const MIN_MS = 60_000;

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

  async measure(rule: AlertRule, scope: TenantScope, now: Date): Promise<Sample> {
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
