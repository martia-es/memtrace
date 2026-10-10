/**
 * Guardia estática de ADR-077: toda consulta de los repositorios de ClickHouse sobre tablas de un tenant lleva el
 * predicado de tenant. Un método nuevo que lea o escriba sin acotar por experimento rompe este test, no un cliente.
 * (La prueba de verdad, con dos tenants reales, está en tests/integration/tenant-isolation.test.ts.)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(__dirname, "..", "src", "adapters", "outbound", "clickhouse");
const REPOSITORIES = [
  "clickhouse-trace-repository.ts",
  "clickhouse-score-repository.ts",
  "clickhouse-annotation-repository.ts",
  "clickhouse-user-feedback-repository.ts",
  "clickhouse-prompt-evidence-repository.ts",
];
/** Métodos que no tocan datos de un tenant (catálogo global, ping) o son el ejecutor genérico de consultas ya construidas. */
const EXEMPT = new Set(["constructor", "getModelPricing", "ping", "rows", "query", "range"]);
const SCOPED = /TENANT_SQL|tenantSqlFor\(|assertTenantScope\(|ExperimentId IN/;
const TOUCHES_STORE = /this\.rows\(|this\.rows<|\.query\(|\.insert\(|this\.select\(|this\.listWhere\(|this\.insert\(/;

/** Corta la clase en métodos: sangrado de 2 espacios y apertura `name(`. */
function methods(source: string): Array<{ name: string; body: string }> {
  const starts = [...source.matchAll(/^ {2}(?:private |public |static )*(?:async )?(\w+)(?:<[^>]*>)?\(/gm)];
  return starts.map((m, i) => ({ name: m[1]!, body: source.slice(m.index!, starts[i + 1]?.index ?? source.length) }));
}

describe("tenant scope guard (ADR-077)", () => {
  it.each(REPOSITORIES)("%s: every method that touches the store applies the tenant predicate", (file) => {
    const unscoped = methods(readFileSync(join(DIR, file), "utf8"))
      .filter((m) => !EXEMPT.has(m.name) && TOUCHES_STORE.test(m.body) && !SCOPED.test(m.body))
      // un método que solo delega en otro (`return this.insert(scope, …)`) lo cumple el delegado, que sí se comprueba
      .filter((m) => !/^\s*(?:return )?this\.\w+\(\s*scope,/m.test(m.body.split("\n").slice(1).join("\n")))
      .map((m) => m.name);
    expect(unscoped).toEqual([]);
  });

  it("covers the repositories that exist", () => {
    // si aparece un repositorio nuevo de ClickHouse, hay que añadirlo a la lista de arriba
    const present = readFileSync(join(__dirname, "..", "src", "dependency-container.ts"), "utf8").match(/ClickHouse\w+Repository/g) ?? [];
    const known = REPOSITORIES.map((f) => f.replace(".ts", "").split("-").map((w) => w[0]!.toUpperCase() + w.slice(1)).join("").replace(/^Clickhouse/, "ClickHouse"));
    expect([...new Set(present)].filter((r) => !known.includes(r))).toEqual([]);
  });
});
