import { ValidationError } from "@/domain/errors";
import { problem } from "./problem";

/** Igual que `guard` en handlers.ts, pero solo para los casos de error que usan las rutas de identidad. */
export async function identityGuard(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ValidationError) return problem(400, "Bad Request", error.message, error.fields);
    console.error("[memtrace-api] Unhandled identity error:", error);
    return problem(500, "Internal Server Error");
  }
}
