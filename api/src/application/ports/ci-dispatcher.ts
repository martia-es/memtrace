import type { RepoConfig } from "@/domain/assistant-registry";

/**
 * Puerto hacia el CI/CD del repositorio del agente (ADR-064). MemTrace solo lo dispara: construir y desplegar es cosa
 * del workflow del equipo. Un adaptador por proveedor (GitHub primero).
 */
export interface CiDispatcher {
  /** SHA completo al que apunta hoy una rama o tag. Lanza `CiUnavailableError` / `AssistantUpstreamError`. */
  resolveRef(repo: RepoConfig, ref: string): Promise<string>;
  /** Lanza el workflow del repo con el commit exacto, el entorno y el id del despliegue (para enlazar su resultado). */
  dispatch(repo: RepoConfig, input: DispatchInput): Promise<{ runUrl: string | null }>;
}

export interface DispatchInput {
  /** rama o tag donde vive el workflow */
  ref: string;
  sha: string;
  environment: string;
  /** marca que el workflow pone en su `run-name` (`deploy:<uuid>`) */
  marker: string;
}
