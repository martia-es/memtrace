/** Composition root: único sitio donde se elige el adapter concreto de cada puerto. */
import type { ComputedRef, InjectionKey } from "vue";
import { HttpTraceApi } from "@/adapters/outbound/http-trace-api";
import { HttpIdentityApi } from "@/adapters/outbound/http-identity-api";
import { HttpAssistantApi } from "@/adapters/outbound/http-assistant-api";
import { HttpPromptApi } from "@/adapters/outbound/http-prompt-api";
import type { AssistantApi } from "@/application/assistant-api";
import type { PromptApi } from "@/application/prompt-api";
import type { TraceApi } from "@/application/trace-api";
import type { ExperimentDto, IdentityApi } from "@/application/identity-api";

export const TRACE_API: InjectionKey<TraceApi> = Symbol("TraceApi");
export const IDENTITY_API: InjectionKey<IdentityApi> = Symbol("IdentityApi");
export const ASSISTANT_API: InjectionKey<AssistantApi> = Symbol("AssistantApi");
export const PROMPT_API: InjectionKey<PromptApi> = Symbol("PromptApi");
/** El experimento actual (según :experimentId de la ruta), provisto por MainLayout: evita refetchear la lista en cada página. */
export const CURRENT_EXPERIMENT: InjectionKey<ComputedRef<ExperimentDto | null>> = Symbol("CurrentExperiment");

export interface Container {
  traceApi: HttpTraceApi;
  identityApi: IdentityApi;
  assistantApi: AssistantApi;
  promptApi: PromptApi;
}

let container: Container | undefined;

/** Singleton: el router (fuera del árbol de componentes) también necesita `traceApi.setExperimentId`. */
export function getContainer(): Container {
  if (!container) {
    container = {
      traceApi: new HttpTraceApi(import.meta.env.VITE_API_BASE_URL ?? "/api/v1"),
      identityApi: new HttpIdentityApi(import.meta.env.VITE_API_BASE_URL ?? "/api/v1"),
      assistantApi: new HttpAssistantApi(import.meta.env.VITE_API_BASE_URL ?? "/api/v1"),
      promptApi: new HttpPromptApi(import.meta.env.VITE_API_BASE_URL ?? "/api/v1"),
    };
  }
  return container;
}
