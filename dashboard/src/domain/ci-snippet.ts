/** Fragmentos de CI para que el commit llegue a las trazas (ADR-065). Sin Vue ni HTTP. */

export type CiProvider = "github" | "gitlab" | "bitbucket";

export const DOCKERFILE_SNIPPET = "ARG GIT_SHA\nENV GIT_SHA=$GIT_SHA";

/** Variable que cada CI rellena con el commit que está construyendo: cambia en cada build. */
const SHA_VARIABLE: Record<CiProvider, string> = {
  github: "${{ github.sha }}",
  gitlab: "$CI_COMMIT_SHA",
  bitbucket: "$BITBUCKET_COMMIT",
};

export const CI_LABEL: Record<CiProvider, string> = { github: "GitHub Actions", gitlab: "GitLab CI", bitbucket: "Bitbucket Pipelines" };

/** Comando de build con el commit como `build-arg`. */
export function buildCommand(provider: CiProvider, image = "my-assistant"): string {
  return `docker build --build-arg GIT_SHA=${SHA_VARIABLE[provider]} -t ${image} .`;
}
