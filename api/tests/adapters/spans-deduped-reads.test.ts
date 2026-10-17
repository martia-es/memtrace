/**
 * ADR-099: los spans pueden estar duplicados hasta que ClickHouse los funde, así que toda lectura de `otel_traces` debe pedir
 * `final = 1` (DEDUPED_READS). Esta prueba falla si se añade una consulta nueva sobre spans sin ello: un recuento o una suma de
 * coste inflados no darían error, solo cifras mal.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(__dirname, "..", "..", "src", "adapters", "outbound", "clickhouse");
// el borrado y el relleno del experimento operan sobre la tabla, no leen para mostrar; el Job de cambio no es una lectura de la API
const EXEMPT = new Set(["experiment-id-backfill.ts", "otel-traces-dedupe.ts", "client.ts"]);

const sources = readdirSync(DIR)
  .filter((f) => f.endsWith(".ts") && !EXEMPT.has(f))
  .map((f) => ({ file: f, text: readFileSync(join(DIR, f), "utf8") }))
  .filter(({ text }) => /\botel_traces\b/.test(text) && /\.query\(/.test(text));

describe("reads of spans are deduplicated (ADR-099)", () => {
  it("there are repositories that read spans", () => {
    expect(sources.map((s) => s.file)).toEqual(expect.arrayContaining(["clickhouse-trace-repository.ts", "clickhouse-breakdown-repository.ts", "clickhouse-prompt-evidence-repository.ts"]));
  });

  it.each(sources.map((s) => [s.file, s.text]))("%s asks for final = 1 on every query", (_file, text) => {
    const queries = [...text.matchAll(/\.query\(\{/g)].length;
    const withFinal = [...text.matchAll(/clickhouse_settings:[^,}]*DEDUPED_READS/g)].length;
    expect(withFinal).toBeGreaterThanOrEqual(queries);
  });

  it("final = 1 is the setting, not the FROM ... FINAL syntax that fails on a MergeTree table", () => {
    const client = readFileSync(join(DIR, "client.ts"), "utf8");
    expect(client).toMatch(/DEDUPED_READS = \{ final: 1 \}/);
  });
});
