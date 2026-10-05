import { inject } from "vue";
import type { AssistantApi } from "@/application/assistant-api";
import { ASSISTANT_API } from "@/dependency-container";

export function useAssistantApi(): AssistantApi {
  const api = inject(ASSISTANT_API);
  if (!api) throw new Error("AssistantApi not provided: missing app.provide(ASSISTANT_API, …) in main.ts");
  return api;
}
