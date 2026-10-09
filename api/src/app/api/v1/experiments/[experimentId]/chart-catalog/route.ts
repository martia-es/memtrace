import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { catalogEntryQuery, saveCatalogEntryBody } from "@/adapters/inbound/http/chart-catalog-schemas";
import type { ChartCatalogEntryDto, ChartCatalogResponse } from "@/adapters/inbound/http/contract";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow, parseQueryOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { getChartCatalog } from "@/dependency-container";
import type { CatalogEntry } from "@/domain/chart-catalog";

export const dynamic = "force-dynamic";

const toDto = (e: CatalogEntry): ChartCatalogEntryDto => ({ kind: e.kind, key: e.key, displayName: e.displayName, visibility: e.visibility, updatedAt: e.updatedAt });

/**
 * Las ediciones del catálogo de datos de este experimento (ADR-078): el nombre de negocio y la visibilidad de pasos y atributos.
 * Solo lo editado: lo que hay en las trazas se descubre aparte. Requiere `experiment:read`, porque todas las gráficas usan los nombres.
 */
export async function GET(_request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requirePermission(experimentId, "experiment:read");
    if (ctx instanceof Response) return ctx;
    const items = await getChartCatalog().list(experimentId);
    return json({ items: items.map(toDto) } satisfies ChartCatalogResponse);
  });
}

/**
 * Pone nombre a un paso o atributo, o lo oculta/muestra en los selectores. Sin nombre y en automático vuelve al valor por defecto
 * (`entry: null`). 400 si el nombre ya lo usa otra entrada del mismo tipo. Requiere `catalog:manage`.
 */
export async function PUT(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requirePermission(experimentId, "catalog:manage");
    if (ctx instanceof Response) return ctx;
    const body = await parseJsonOrThrow(saveCatalogEntryBody, request);
    const saved = await getChartCatalog().save(experimentId, ctx.user.id, body);
    return json({ entry: saved ? toDto(saved) : null });
  });
}

/** Vuelve a automático el nombre y la visibilidad de un paso o atributo: `?kind=step|attribute&key=…`. Requiere `catalog:manage`. */
export async function DELETE(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requirePermission(experimentId, "catalog:manage");
    if (ctx instanceof Response) return ctx;
    const query = parseQueryOrThrow(catalogEntryQuery, request);
    return json({ deleted: await getChartCatalog().remove(experimentId, query.kind, query.key) });
  });
}
