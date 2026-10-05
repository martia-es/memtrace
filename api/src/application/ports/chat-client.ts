/** Resultado de una llamada de chat al asistente. No lanza: un fallo de red es un resultado (`httpStatus: null`). */
export interface ChatCallResult {
  httpStatus: number | null;
  /** JSON de la respuesta; null si no era JSON o no hubo respuesta */
  body: unknown;
  latencyMs: number | null;
  error: string | null;
}

/** Hace el POST de chat a un asistente (ADR-055). Con las mismas reglas SSRF que el sondeo de /health. */
export interface ChatClient {
  send(url: string, body: Record<string, string>): Promise<ChatCallResult>;
}
