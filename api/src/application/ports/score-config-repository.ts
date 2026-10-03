import type { NewScoreConfig, ScoreConfig, ScoreConfigChanges } from "@/domain/score-config";

/** Almacén de score configs (ADR-036). PostgreSQL: bajo volumen, transaccional, referenciado por anotaciones y colas. */
export interface ScoreConfigRepository {
  list(experimentId: string, includeArchived: boolean): Promise<ScoreConfig[]>;
  get(experimentId: string, configId: string): Promise<ScoreConfig | null>;
  /** Lanza `ScoreConfigInvariantError` si ya hay una config activa con ese nombre. */
  create(experimentId: string, createdByUserId: string, input: NewScoreConfig): Promise<ScoreConfig>;
  /** Devuelve null si la config no existe en ese experimento. */
  update(experimentId: string, configId: string, changes: ScoreConfigChanges): Promise<ScoreConfig | null>;
  /** Lanza `ScoreConfigInvariantError` al desarchivar si el nombre ya lo usa otra config activa. Devuelve null si no existe. */
  setArchived(experimentId: string, configId: string, archived: boolean): Promise<ScoreConfig | null>;
}
