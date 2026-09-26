/** Regla de dependencias hexagonal: el núcleo no conoce tecnologías ni adapters. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "src");

const FORBIDDEN: Record<string, RegExp[]> = {
  domain: [/^@clickhouse/, /^next/, /^zod/, /^@\/(application|adapters|dependency-container)/],
  application: [/^@clickhouse/, /^next/, /^zod/, /^@\/(adapters|dependency-container)/],
  "adapters/inbound": [/^@clickhouse/, /^@\/adapters\/outbound/],
  "adapters/outbound": [/^next/, /^@\/adapters\/inbound/],
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });
}

function imports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((m) => m[1]!);
}

describe("dependency rule", () => {
  it.each(Object.entries(FORBIDDEN))("%s respects its boundaries", (layer, banned) => {
    const violations = files(join(SRC, layer)).flatMap((file) =>
      imports(file)
        .filter((mod) => banned.some((rule) => rule.test(mod)))
        .map((mod) => `${relative(SRC, file)} imports ${mod}`),
    );
    expect(violations).toEqual([]);
  });
});
