/** Every message key written literally in the code (`t("area.key")`, ternaries, `tp` bases…) exists in the catalog. */
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

const messages = Object.keys(en);
const namespaces = new Set(messages.map((k) => k.split(".")[0]!));
const LITERAL = /(?<!=)(["'])([a-z][A-Za-z0-9]*)\.([A-Za-z0-9_.]+)\1/g;

const exists = (key: string) => messages.includes(key) || messages.includes(`${key}.one`) || messages.some((k) => k.startsWith(`${key}.`));

describe("i18n keys", () => {
  it("every literal key used in the code exists in the catalog", () => {
    const missing: string[] = [];
    for (const file of files(SRC)) {
      if (file.includes("/i18n/")) continue;
      const code = readFileSync(file, "utf8");
      for (const [, , ns, rest] of code.matchAll(LITERAL)) {
        if (!namespaces.has(ns!)) continue;
        const key = `${ns}.${rest}`;
        if (!exists(key)) missing.push(`${file.replace(SRC, "src")}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
