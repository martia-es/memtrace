import { getHandlers } from "@/dependency-container";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await context.params;
  return getHandlers().getTranscript(request, conversationId);
}
