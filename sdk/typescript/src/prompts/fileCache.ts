import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PromptCache, PromptVersion } from "./domain.js";

/** One small JSON file per (prompt, tag or version), the same format as the Python SDK. Every failure is swallowed. */
export class FilePromptCache implements PromptCache {
  constructor(private readonly directory: string) {}

  private path(name: string, tag: string | undefined, version: number | undefined): string {
    // names and tags are slugs (the API enforces it), but never trust a value that ends up in a path
    const safe = [...`${name}__${tag ?? ""}__${version ?? ""}`].map((c) => (/[A-Za-z0-9._-]/.test(c) ? c : "_")).join("");
    return join(this.directory, `${safe}.json`);
  }

  load(name: string, tag: string | undefined, version: number | undefined): PromptVersion | undefined {
    try {
      const data = JSON.parse(readFileSync(this.path(name, tag, version), "utf8"));
      return {
        name: data.name, version: Number(data.version), content: data.content, variables: [...(data.variables ?? [])],
        contentHash: data.content_hash ?? "", archived: Boolean(data.archived ?? false), draft: Boolean(data.draft ?? false),
      };
    } catch {
      return undefined;
    }
  }

  store(name: string, tag: string | undefined, version: number | undefined, value: PromptVersion): void {
    try {
      mkdirSync(this.directory, { recursive: true });
      const target = this.path(name, tag, version);
      const temp = `${target}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify({
        name: value.name, version: value.version, content: value.content, variables: value.variables,
        content_hash: value.contentHash, archived: value.archived, draft: value.draft,
      }));
      renameSync(temp, target); // atomic: a reader never sees half a file
    } catch {
      /* the cache is a convenience */
    }
  }
}
