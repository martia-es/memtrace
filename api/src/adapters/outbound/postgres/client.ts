import { Pool } from "pg";

export interface PostgresConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): PostgresConfig {
  return {
    host: env.POSTGRES_HOST ?? "localhost",
    port: Number(env.POSTGRES_PORT ?? 5432),
    user: env.POSTGRES_USER ?? "memtrace",
    password: env.POSTGRES_PASSWORD ?? "",
    database: env.POSTGRES_DATABASE ?? "memtrace_identity",
  };
}

export function createPool(config: PostgresConfig): Pool {
  return new Pool(config);
}
