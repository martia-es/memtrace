export class ValidationError extends Error {
  constructor(
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export class TraceNotFoundError extends Error {
  constructor(readonly traceId: string) {
    super(`Trace ${traceId} not found`);
    this.name = "TraceNotFoundError";
  }
}
