import { inject } from "vue";
import type { IdentityApi } from "@/application/identity-api";
import { IDENTITY_API } from "@/dependency-container";

export function useIdentityApi(): IdentityApi {
  const api = inject(IDENTITY_API);
  if (!api) throw new Error("IdentityApi not provided: missing app.provide(IDENTITY_API, …) in main.ts");
  return api;
}
