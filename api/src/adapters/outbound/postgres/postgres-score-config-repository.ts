import type { Pool } from "pg";
import type { ScoreConfigRepository } from "@/application/ports/score-config-repository";
import type { ScoreDataType } from "@/domain/evaluation";
import { ScoreConfigInvariantError } from "@/domain/errors";
import type { NewScoreConfig, ScoreConfig, ScoreConfigCategory, ScoreConfigChanges } from "@/domain/score-config";

const COLUMNS = `id, experiment_id, name, data_type, min_value, max_value, categories, target_pass_rate, description, created_by, created_at, updated_at, archived_at`;
const UNIQUE_VIOLATION = "23505";
// un id con otra forma haría fallar el cast a uuid de Postgres (500): desde la API es simplemente "no existe" (404)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ScoreConfigRow {
  id: string;
  experiment_id: string;
  name: string;
  data_type: ScoreDataType;
  min_value: number | null;
  max_value: number | null;
  categories: ScoreConfigCategory[] | null;
  target_pass_rate: number | null;
  description: string | null;
  created_by: string;
  created_at: Date | string;
  updated_at: Date | string;
  archived_at: Date | string | null;
}

export class PostgresScoreConfigRepository implements ScoreConfigRepository {
  constructor(private readonly pool: Pool) {}

  async list(experimentId: string, includeArchived: boolean): Promise<ScoreConfig[]> {
    const { rows } = await this.pool.query<ScoreConfigRow>(
      `SELECT ${COLUMNS} FROM score_configs
        WHERE experiment_id = $1 ${includeArchived ? "" : "AND archived_at IS NULL"}
        ORDER BY name ASC, created_at ASC`,
      [experimentId],
    );
    return rows.map(toScoreConfig);
  }

  async get(experimentId: string, configId: string): Promise<ScoreConfig | null> {
    if (!UUID.test(configId)) return null;
    const { rows } = await this.pool.query<ScoreConfigRow>(`SELECT ${COLUMNS} FROM score_configs WHERE id = $1 AND experiment_id = $2`, [configId, experimentId]);
    return rows[0] ? toScoreConfig(rows[0]) : null;
  }

  async create(experimentId: string, createdByUserId: string, input: NewScoreConfig): Promise<ScoreConfig> {
    try {
      const { rows } = await this.pool.query<ScoreConfigRow>(
        `INSERT INTO score_configs (experiment_id, name, data_type, min_value, max_value, categories, target_pass_rate, description, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING ${COLUMNS}`,
        [experimentId, input.name, input.dataType, input.minValue, input.maxValue, input.categories ? JSON.stringify(input.categories) : null, input.targetPassRate ?? null, input.description, createdByUserId],
      );
      return toScoreConfig(rows[0]!);
    } catch (error) {
      throw mapNameTaken(error, input.name);
    }
  }

  async update(experimentId: string, configId: string, changes: ScoreConfigChanges): Promise<ScoreConfig | null> {
    if (!UUID.test(configId)) return null;
    const { rows } = await this.pool.query<ScoreConfigRow>(
      `UPDATE score_configs
          SET description = $3, min_value = $4, max_value = $5, categories = $6, target_pass_rate = $7, updated_at = now()
        WHERE id = $1 AND experiment_id = $2
        RETURNING ${COLUMNS}`,
      [configId, experimentId, changes.description, changes.minValue, changes.maxValue, changes.categories ? JSON.stringify(changes.categories) : null, changes.targetPassRate],
    );
    return rows[0] ? toScoreConfig(rows[0]) : null;
  }

  async setArchived(experimentId: string, configId: string, archived: boolean): Promise<ScoreConfig | null> {
    if (!UUID.test(configId)) return null;
    try {
      const { rows } = await this.pool.query<ScoreConfigRow>(
        `UPDATE score_configs
            SET archived_at = ${archived ? "COALESCE(archived_at, now())" : "NULL"}, updated_at = now()
          WHERE id = $1 AND experiment_id = $2
          RETURNING ${COLUMNS}`,
        [configId, experimentId],
      );
      return rows[0] ? toScoreConfig(rows[0]) : null;
    } catch (error) {
      throw mapNameTaken(error, "this name");
    }
  }
}

function mapNameTaken(error: unknown, name: string): unknown {
  if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
    return new ScoreConfigInvariantError(`An active score config named "${name}" already exists in this experiment`);
  }
  return error;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toScoreConfig(row: ScoreConfigRow): ScoreConfig {
  return {
    id: row.id,
    experimentId: row.experiment_id,
    name: row.name,
    dataType: row.data_type,
    minValue: row.min_value,
    maxValue: row.max_value,
    categories: row.categories ? row.categories.map((c) => ({ label: c.label, value: c.value ?? null })) : null,
    targetPassRate: row.target_pass_rate,
    description: row.description,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    archivedAt: row.archived_at ? iso(row.archived_at) : null,
  };
}
