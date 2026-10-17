/** Every key written literally in a `t()`, `tp()` or `tr()` call has an English message (and so a Spanish one, see i18n.test.ts). */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/ui/i18n/en";

const SRC = join(__dirname, "..", "..", "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|vue)$/.test(name) ? [path] : [];
  });
}

const CALL = /(?<![\w.$])(t|tp|tr)\(\s*(["'])([A-Za-z][\w.]*)\2/g;
const messages = en as Record<string, string>;

describe("i18n keys", () => {
  it("every literal key used in the code exists in the catalog", () => {
    const missing: string[] = [];
    for (const file of files(SRC)) {
      if (file.includes("/i18n/")) continue;
      const code = readFileSync(file, "utf8");
      for (const [, fn, , key] of code.matchAll(CALL)) {
        const keys = fn === "tp" ? [`${key}.one`, `${key}.other`] : [key!];
        for (const k of keys) if (!(k in messages)) missing.push(`${file.replace(SRC, "src")}: ${k}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
