import { inject } from "vue";
import type { PromptApi } from "@/application/prompt-api";
import { PROMPT_API } from "@/dependency-container";

export function usePromptApi(): PromptApi {
  const api = inject(PROMPT_API);
  if (!api) throw new Error("PromptApi not provided: missing app.provide(PROMPT_API, …) in main.ts");
  return api;
}
