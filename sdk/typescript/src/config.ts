import { execFileSync } from "node:child_process";

const TRUE = new Set(["1", "true", "yes", "on"]);
const SHA = /^[0-9a-f]{7,64}$/;

/** Variables that pin the commit, in priority order (ADR-065). */
export const REVISION_ENV_VARS = [
  "MEMTRACE_GIT_SHA",
  "GIT_SHA",
  "GITHUB_SHA",
  "CI_COMMIT_SHA",
  "VERCEL_GIT_COMMIT_SHA",
  "RENDER_GIT_COMMIT",
  "HEROKU_SLUG_COMMIT",
] as const;

export function envBool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  return value === undefined ? fallback : TRUE.has(value.trim().toLowerCase());
}

export function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** Parses `k1=v1,k2=v2` (the format of OTEL_EXPORTER_OTLP_HEADERS). */
export function parseHeaders(raw: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const pair of (raw ?? "").split(",")) {
    const at = pair.indexOf("=");
    const key = at > 0 ? pair.slice(0, at).trim() : "";
    if (key) headers[key] = pair.slice(at + 1).trim();
  }
  return headers;
}

function git(...args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

/** Commit being run and whether the tree has uncommitted changes (`undefined` = unknown). Never throws. */
export function resolveRevision(): { sha?: string; dirty?: boolean } {
  for (const name of REVISION_ENV_VARS) {
    const value = (process.env[name] ?? "").trim().toLowerCase();
    if (SHA.test(value)) return { sha: value };
  }
  const sha = (git("rev-parse", "HEAD") ?? "").toLowerCase();
  if (!SHA.test(sha)) return {};
  const status = git("status", "--porcelain");
  return status === undefined ? { sha } : { sha, dirty: status !== "" };
}

/** Configuration read from the environment on every access, like the Python SDK (ADR-095). */
export const settings = {
  get enabled() { return envBool("MEMTRACE_ENABLED", true); },
  get otlpEndpoint() { return process.env.MEMTRACE_OTLP_ENDPOINT || undefined; },
  get otlpHeaders() { return parseHeaders(process.env.MEMTRACE_OTLP_HEADERS); },
  get serviceName() { return process.env.MEMTRACE_SERVICE_NAME ?? "default-agent"; },
  get serviceVersion() { return process.env.MEMTRACE_SERVICE_VERSION || undefined; },
  get environment() { return process.env.MEMTRACE_ENVIRONMENT || undefined; },
  get captureContent() { return envBool("MEMTRACE_CAPTURE_CONTENT", false); },
  get maxContentLength() { return envInt("MEMTRACE_MAX_CONTENT_LENGTH", 16384); },
  get redactKeys() {
    return (process.env.MEMTRACE_REDACT_KEYS ?? "").split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);
  },
  get exportTimeoutMs() { return envInt("MEMTRACE_EXPORT_TIMEOUT_MS", 5000); },
  get batchMaxQueueSize() { return envInt("MEMTRACE_BATCH_MAX_QUEUE_SIZE", 2048); },
  get batchScheduleDelayMs() { return envInt("MEMTRACE_BATCH_SCHEDULE_DELAY_MS", 5000); },
  get batchMaxExportSize() { return envInt("MEMTRACE_BATCH_MAX_EXPORT_SIZE", 512); },
  get apiUrl() { return process.env.MEMTRACE_API_URL || undefined; },
  get apiKey() { return process.env.MEMTRACE_API_KEY || undefined; },
  /** How often a prompt that follows a tag asks whether the tag moved (an unchanged tag costs a 304). */
  get promptRefreshSeconds() { return envInt("MEMTRACE_PROMPT_REFRESH_SECONDS", 30); },
  /** How often the SDK tells MemTrace which prompt versions this agent is using. */
  get promptUsageSeconds() { return envInt("MEMTRACE_PROMPT_USAGE_SECONDS", 300); },
  get promptTimeoutSeconds() { return envInt("MEMTRACE_PROMPT_TIMEOUT_SECONDS", 3); },
  /** Lets MemTrace's playground run another prompt version in this process for one request (ADR-071). Off by default. */
  get allowPromptOverride() { return envBool("MEMTRACE_ALLOW_PROMPT_OVERRIDE", false); },
  get promptCacheDir() { return process.env.MEMTRACE_PROMPT_CACHE_DIR || undefined; },
};
