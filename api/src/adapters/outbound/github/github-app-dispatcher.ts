import { createSign } from "node:crypto";
import type { CiDispatcher, DispatchInput } from "@/application/ports/ci-dispatcher";
import type { RepoConfig } from "@/domain/assistant-registry";
import { parseGithubRepo } from "@/domain/deploy";
import { AssistantUpstreamError, CiUnavailableError } from "@/domain/errors";

export interface GithubAppConfig {
  appId: string;
  /** clave privada PEM de la GitHub App; admite `\n` literales */
  privateKey: string;
  apiBase?: string;
  timeoutMs?: number;
}

const b64url = (input: Buffer | string): string => Buffer.from(input).toString("base64url");

/** JWT RS256 de la App (válido 9 min; GitHub admite hasta 10). */
export function appJwt(config: Pick<GithubAppConfig, "appId" | "privateKey">, nowSeconds: number): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: nowSeconds - 30, exp: nowSeconds + 9 * 60, iss: config.appId }));
  const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(config.privateKey.replace(/\\n/g, "\n"));
  return `${header}.${payload}.${b64url(signature)}`;
}

type Fetch = typeof fetch;

/**
 * Dispara GitHub Actions con una GitHub App (ADR-064). La App se instala en los repos de la organización con permisos
 * mínimos (Contents: read, Actions: write, Metadata: read). La credencial vive en el entorno del servidor, nunca en la base
 * de datos ni en el navegador. El token de instalación se pide por repo y se reutiliza hasta poco antes de caducar.
 */
export class GithubAppDispatcher implements CiDispatcher {
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();
  private readonly base: string;

  constructor(
    private readonly config: GithubAppConfig,
    private readonly http: Fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    this.base = (config.apiBase ?? "https://api.github.com").replace(/\/+$/, "");
  }

  async resolveRef(repo: RepoConfig, ref: string): Promise<string> {
    const target = this.target(repo);
    const token = await this.installationToken(target);
    const found = await this.call<{ sha?: string }>(`/repos/${target.owner}/${target.repo}/commits/${encodeURIComponent(ref)}`, "GET", token);
    if (!found?.sha || !/^[0-9a-f]{40,64}$/i.test(found.sha)) throw new AssistantUpstreamError(`GitHub did not return a commit for "${ref}"`);
    return found.sha.toLowerCase();
  }

  async dispatch(repo: RepoConfig, input: DispatchInput): Promise<{ runUrl: string | null }> {
    const target = this.target(repo);
    const workflow = repo.deployWorkflow;
    if (!workflow) throw new AssistantUpstreamError("The agent has no deploy workflow");
    const token = await this.installationToken(target);
    await this.call(`/repos/${target.owner}/${target.repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, "POST", token, {
      ref: input.ref,
      inputs: { sha: input.sha, environment: input.environment, deploy_id: input.marker },
    });
    return { runUrl: `https://github.com/${target.owner}/${target.repo}/actions/workflows/${encodeURIComponent(workflow)}` };
  }

  private target(repo: RepoConfig): { owner: string; repo: string } {
    if (repo.provider !== "github") throw new CiUnavailableError(`Deploying from MemTrace is not available for ${repo.provider} yet; only GitHub is supported`);
    const parsed = parseGithubRepo(repo.url);
    if (!parsed) throw new CiUnavailableError("The repository URL must look like https://github.com/owner/name");
    return parsed;
  }

  private async installationToken(target: { owner: string; repo: string }): Promise<string> {
    const key = `${target.owner}/${target.repo}`;
    const cached = this.tokens.get(key);
    if (cached && cached.expiresAt - this.now() > 5 * 60_000) return cached.token;
    const jwt = appJwt(this.config, Math.floor(this.now() / 1000));
    const installation = await this.call<{ id?: number }>(`/repos/${target.owner}/${target.repo}/installation`, "GET", jwt, undefined, "GitHub App is not installed on this repository");
    if (!installation?.id) throw new CiUnavailableError("The MemTrace GitHub App is not installed on this repository");
    const created = await this.call<{ token?: string; expires_at?: string }>(`/app/installations/${installation.id}/access_tokens`, "POST", jwt);
    if (!created?.token) throw new AssistantUpstreamError("GitHub did not return an installation token");
    this.tokens.set(key, { token: created.token, expiresAt: created.expires_at ? Date.parse(created.expires_at) : this.now() + 50 * 60_000 });
    return created.token;
  }

  private async call<T>(path: string, method: "GET" | "POST", bearer: string, body?: unknown, notFoundMessage?: string): Promise<T | undefined> {
    let response: Response;
    try {
      response = await this.http(`${this.base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${bearer}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "memtrace",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
      });
    } catch (error) {
      throw new AssistantUpstreamError(`Could not reach GitHub: ${error instanceof Error ? error.message : "network error"}`);
    }
    if (response.status === 404 && notFoundMessage) throw new CiUnavailableError(notFoundMessage);
    if (!response.ok) {
      const detail = await response.text().then((t) => t.slice(0, 200), () => "");
      throw new AssistantUpstreamError(`GitHub answered ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    return response.status === 204 ? undefined : ((await response.json()) as T);
  }
}

/** Sin GitHub App configurada: despliegues desde MemTrace desactivados, el resto sigue funcionando. */
export class UnconfiguredDispatcher implements CiDispatcher {
  async resolveRef(): Promise<string> {
    throw new CiUnavailableError("Deploying from MemTrace is not configured: the GitHub App credentials (GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY) are missing");
  }
  async dispatch(): Promise<{ runUrl: string | null }> {
    return this.resolveRef().then(() => ({ runUrl: null }));
  }
}
