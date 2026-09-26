import { getHandlers } from "@/dependency-container";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ traceId: string }> }) {
  const { traceId } = await context.params;
  return getHandlers().getTrace(request, traceId);
}
