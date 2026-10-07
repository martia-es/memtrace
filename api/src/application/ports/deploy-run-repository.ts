import type { DeployRun, DeployStatus, NewDeployRun } from "@/domain/deploy";

/** Historial de despliegues lanzados desde MemTrace (ADR-064). PostgreSQL. */
export interface DeployRunRepository {
  create(input: NewDeployRun): Promise<DeployRun>;
  get(id: string): Promise<DeployRun | null>;
  /** ¿Hay un despliegue en curso (en cola o corriendo, de menos de una hora) en este entorno? Evita lanzar dos a la vez. */
  hasActive(deploymentId: string): Promise<boolean>;
  /** Más recientes primero. */
  listForDeployment(deploymentId: string, limit: number): Promise<DeployRun[]>;
  /** Cambia el estado. Un despliegue ya terminado no se reabre: devuelve null si no existe o ya estaba en un estado final. */
  setStatus(id: string, status: DeployStatus, patch?: { providerRunUrl?: string | null; error?: string | null }): Promise<DeployRun | null>;
  /** SHAs que se desplegaron con éxito en algún entorno del experimento (para el rollback del gate). */
  succeededShas(experimentId: string): Promise<string[]>;
}
