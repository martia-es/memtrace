import { ASSISTANT_READ, ASSISTANT_WRITE, requireAnyPermission } from "@/adapters/inbound/http/auth-context";
import { toConnectionDto } from "@/adapters/inbound/http/assistant-mappers";
import { declareConnectionBody } from "@/adapters/inbound/http/assistant-schemas";
import type { ConnectionsResponse } from "@/adapters/inbound/http/contract";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { getAssistantRegistry } from "@/dependency-container";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ experimentId: string }> };

/** Servidores MCP, tools y agentes del asistente, declarados y observados, con el uso de las tools en los últimos 7 días. */
export async function GET(_request: Request, context: Ctx) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requireAnyPermission(experimentId, ASSISTANT_READ);
    if (ctx instanceof Response) return ctx;
    const items = await getAssistantRegistry().listConnections(experimentId, ctx.serviceName);
    return json({ items: items.map(toConnectionDto) } satisfies ConnectionsResponse);
  });
}

/** Declara una conexión que el asistente debe usar. */
export async function POST(request: Request, context: Ctx) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requireAnyPermission(experimentId, ASSISTANT_WRITE);
    if (ctx instanceof Response) return ctx;
    const body = await parseJsonOrThrow(declareConnectionBody, request);
    const connection = await getAssistantRegistry().declareConnection(experimentId, body);
    return json(toConnectionDto({ ...connection, usage: null }), 201);
  });
}
