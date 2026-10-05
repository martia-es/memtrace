import type { ProbeResult } from "@/domain/assistant-registry";

/** Hace la llamada GET a /health de un despliegue (ADR-053). No lanza: un fallo de red es un resultado (`httpStatus: null`). */
export interface HealthProber {
  probe(url: string): Promise<ProbeResult>;
}
