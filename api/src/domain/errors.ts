export class ValidationError extends Error {
  constructor(
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export class ConversationNotFoundError extends Error {
  constructor(readonly conversationId: string) {
    super(`Conversation ${conversationId} not found`);
    this.name = "ConversationNotFoundError";
  }
}

export class TraceNotFoundError extends Error {
  constructor(readonly traceId: string) {
    super(`Trace ${traceId} not found`);
    this.name = "TraceNotFoundError";
  }
}
