import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");

// El job `postgres-migrate` solo ve los archivos listados en kustomization.yaml: una migración
// que no esté ahí existe en el repo pero nunca se aplica (y la API falla con "column does not exist").
describe("postgres migrations", () => {
  it("are all registered in kustomization.yaml", () => {
    const kustomization = readFileSync(resolve(root, "kustomization.yaml"), "utf8");
    const missing = readdirSync(resolve(root, "migrations/postgres"))
      .filter((file) => file.endsWith(".sql"))
      .filter((file) => !kustomization.includes(`migrations/postgres/${file}`));
    expect(missing).toEqual([]);
  });
});
