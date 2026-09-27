import { inject } from "vue";
import type { TraceApi } from "@/application/trace-api";
import { TRACE_API } from "@/dependency-container";

export function useTraceApi(): TraceApi {
  const api = inject(TRACE_API);
  if (!api) throw new Error("TraceApi not provided: missing app.provide(TRACE_API, …) in main.ts");
  return api;
}
