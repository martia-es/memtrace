/** Regla de dependencias hexagonal del dashboard. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "src");

const FRAMEWORKS = [/^vue($|\/)/, /^quasar/, /^echarts/, /^@quasar/, /^vue-router/];
const FORBIDDEN: Record<string, RegExp[]> = {
  domain: [...FRAMEWORKS, /^@\/(application|adapters|ui|dependency-container)/],
  application: [...FRAMEWORKS, /^@\/(adapters|ui|dependency-container)/],
  "adapters/outbound": [...FRAMEWORKS, /^@\/ui/],
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") || path.endsWith(".vue") ? [path] : [];
  });
}
const imports = (file: string) => [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((m) => m[1]!);

describe("dependency rule", () => {
  it.each(Object.entries(FORBIDDEN))("%s respects its boundaries", (layer, banned) => {
    const violations = files(join(SRC, layer)).flatMap((file) =>
      imports(file).filter((mod) => banned.some((r) => r.test(mod))).map((mod) => `${relative(SRC, file)} imports ${mod}`),
    );
    expect(violations).toEqual([]);
  });

  it("only the http adapter knows about fetch and the API base path", () => {
    const offenders = files(SRC).filter((f) => !f.includes("adapters/outbound") && /\bfetch\(/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });
});
