import { assertTenantScope, type TenantScope } from "@/domain/tenant";

/**
 * Predicado de tenant de toda consulta (ADR-077). `ServiceName` va primero porque es el prefijo de la clave primaria
 * (poda de partes); `ExperimentId` es el que aísla de verdad, porque el nombre de servicio solo es único por organización.
 */
export const TENANT_SQL = "ServiceName = {tenantService:String} AND ExperimentId = {tenantExperiment:String}";

/** Lo mismo para una tabla con alias (JOIN). */
export const tenantSqlFor = (alias: string) => `${alias}.ServiceName = {tenantService:String} AND ${alias}.ExperimentId = {tenantExperiment:String}`;

export function tenantParams(scope: TenantScope): { tenantService: string; tenantExperiment: string } {
  const { serviceName, experimentId } = assertTenantScope(scope);
  return { tenantService: serviceName, tenantExperiment: experimentId };
}
