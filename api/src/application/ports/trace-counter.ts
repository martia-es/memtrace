import type { TenantScope } from "@/domain/tenant";

/** Cuenta los spans anteriores a una fecha, para avisar de lo que borraría un plazo más corto (ADR-102). Solo lee. */
export interface TraceCounter {
  countOlderThan(scope: TenantScope, cutoff: Date): Promise<number>;
}
