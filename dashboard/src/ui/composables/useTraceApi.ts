import { inject } from "vue";
import type { TraceApi } from "@/application/trace-api";
import { TRACE_API } from "@/dependency-container";

export function useTraceApi(): TraceApi {
  const api = inject(TRACE_API);
  if (!api) throw new Error("TraceApi no proporcionado: falta app.provide(TRACE_API, …) en main.ts");
  return api;
}
