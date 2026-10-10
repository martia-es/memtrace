import type { TenantScope } from "@/domain/tenant";

/** Borrado de trazas antiguas en el almacén analítico (ADR-084). Lo implementa un adapter con un usuario que solo puede borrar. */
export interface TracePurger {
  /** Borra los spans (y sus temáticas derivadas) del experimento anteriores a `cutoff`. Devuelve cuántos spans había que borrar. */
  purge(scope: TenantScope, cutoff: Date): Promise<{ spans: number }>;
}
