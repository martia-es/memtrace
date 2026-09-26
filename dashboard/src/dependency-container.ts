/** Composition root: único sitio donde se elige el adapter concreto del puerto. */
import type { InjectionKey } from "vue";
import { HttpTraceApi } from "@/adapters/outbound/http-trace-api";
import type { TraceApi } from "@/application/trace-api";

export const TRACE_API: InjectionKey<TraceApi> = Symbol("TraceApi");

export function createContainer(): { traceApi: TraceApi } {
  return { traceApi: new HttpTraceApi(import.meta.env.VITE_API_BASE_URL ?? "/api/v1") };
}
