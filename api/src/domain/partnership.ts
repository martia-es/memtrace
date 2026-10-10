/**
 * Relación partner entre organizaciones (ADR-091, opción A). La organización del cliente es la frontera dura de
 * aislamiento; la consultora (organización partner) no ve nada por serlo: el org_admin del cliente concede, persona a
 * persona, un rol de experimento sobre toda su organización o sobre un experimento concreto.
 */
import type { Permission } from "./permissions";

/**
 * Permisos que un grant de partner nunca concede, tenga el rol que tenga: sacar los datos del cliente fuera de la plataforma
 * es decisión del cliente, no de quien lo opera para él. Se filtran al resolver el acceso, así que `technical` sigue
 * sirviendo para trabajar (prompts, colas, datasets) sin poder exportar.
 */
export const PARTNER_DENIED_PERMISSIONS: readonly Permission[] = ["data:export"];

export interface PartnerGrant {
  id: string;
  partnershipId: string;
  userId: string;
  userEmail: string;
  userName: string | null;
  /** rol de experimento (`technical`, `business`…): nunca de organización */
  role: string;
  /** null = todos los experimentos de la organización cliente, también los que se creen después */
  experimentId: string | null;
  grantedBy: string;
  createdAt: string;
}

export interface Partnership {
  id: string;
  clientOrganizationId: string;
  partnerOrganizationId: string;
  partnerOrganizationName: string;
  createdBy: string;
  createdAt: string;
  grants: PartnerGrant[];
}

/** Lo que ve una persona de la consultora: solo clientes que le han dado acceso, con los experimentos y el rol concedidos. */
export interface PartnerClient {
  organizationId: string;
  organizationName: string;
  partnershipId: string;
  experiments: Array<{ id: string; name: string; role: string }>;
}

export interface NewPartnerGrant {
  /** se identifica por email: el cliente no puede listar a la gente de la consultora */
  email: string;
  role: string;
  experimentId: string | null;
}
