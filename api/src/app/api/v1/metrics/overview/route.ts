import { getHandlers } from "@/dependency-container";

export const dynamic = "force-dynamic";

export const GET = (request: Request) => getHandlers().overview(request);
