import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { getExport, getIdentity } from "@/dependency-container";
import { json, problem } from "@/adapters/inbound/http/problem";

export const dynamic = "force-dynamic";

/**
 * Exporta datos del experimento como JSON Lines (ADR-080): `?kind=traces|annotations|feedback|scores&from=&to=` (ISO 8601,
 * como mucho 31 días). Requiere `data:export`. La exportación se registra en la auditoría ANTES de enviar el primer byte; si no
 * se puede registrar, no se exporta. El fichero va en flujo, una fila por línea, sin orden garantizado.
 * Con `dryRun=1` solo valida y devuelve `{ rows, maxRows }`, sin registrar nada.
 */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const access = await requirePermission(experimentId, "data:export");
    if (access instanceof Response) return access;
    const experiment = await getIdentity().identityRepository.getExperiment(experimentId);
    if (!experiment) return problem(404, "Not Found", "Experiment not found");

    const q = new URL(request.url).searchParams;
    // `dryRun=1`: valida y cuenta sin exportar ni registrar nada (la pantalla lo usa antes de ofrecer la descarga)
    if (q.get("dryRun") === "1") {
      return json(await getExport().preview({ serviceName: access.serviceName, kind: q.get("kind"), from: q.get("from"), to: q.get("to") }));
    }
    const started = await getExport().start({
      organizationId: experiment.organizationId,
      experimentId,
      serviceName: access.serviceName,
      actor: { userId: access.user.id, email: access.user.email },
      kind: q.get("kind"),
      from: q.get("from"),
      to: q.get("to"),
    });

    const encoder = new TextEncoder();
    const iterator = started.lines[Symbol.asyncIterator]();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) controller.close();
          else controller.enqueue(encoder.encode(`${next.value}\n`));
        } catch (error) {
          console.error("[export] stream failed:", error);
          controller.error(error);
        }
      },
      async cancel() {
        await iterator.return?.();
      },
    });
    return new Response(body, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Content-Disposition": `attachment; filename="${started.filename}"`,
        "X-Export-Rows": String(started.rows),
        "Cache-Control": "no-store",
      },
    });
  });
}
