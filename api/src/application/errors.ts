/** El almacén no responde o falló; el mensaje del driver no debe llegar al cliente. */
export class RepositoryUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("Trace store unavailable", { cause });
    this.name = "RepositoryUnavailableError";
  }
}
