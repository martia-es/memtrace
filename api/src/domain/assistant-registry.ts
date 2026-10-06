import { ValidationError } from "./errors";

/**
 * Registro de asistentes para gobernanza de la IA (ADR-053). Tipos del modelo y reglas puras: estado global de un
 * asistente, URL de /health, qué despliegues toca sondear y qué conexiones hay que revisar. Sin tecnología.
 */

export type HealthStatus = "up" | "degraded" | "down" | "unknown";
export type AuthMethod = "none" | "api_key" | "oauth2" | "mtls" | "other";
export type ConnectionKind = "mcp_server" | "tool" | "agent";
export type ConnectionStatus = "pending" | "approved" | "blocked";
export type GrantSubjectType = "user" | "group" | "everyone";
export type GrantSource = "manual" | "oidc" | "scim";
export type AssistantLifecycle = "active" | "retired";

export interface Environment {
  id: string;
  organizationId: string;
  key: string;
  label: string;
  position: number;
  isProduction: boolean;
  /** intervalo de sondeo por defecto de /health */
  healthIntervalSeconds: number;
}

/** Entornos que recibe toda organización nueva (y la migración 021 para las existentes). */
export const DEFAULT_ENVIRONMENTS: ReadonlyArray<Omit<Environment, "id" | "organizationId">> = [
  { key: "dev", label: "DEV", position: 0, isProduction: false, healthIntervalSeconds: 300 },
  { key: "pre", label: "PRE", position: 1, isProduction: false, healthIntervalSeconds: 300 },
  { key: "pro", label: "PRO", position: 2, isProduction: true, healthIntervalSeconds: 60 },
];

/** Mínimo entre sondeos, igual que el CHECK de la base de datos. */
export const MIN_HEALTH_INTERVAL_SECONDS = 15;

/**
 * Cómo se habla con un agente (ADR-055). El path es único por agente (igual en todos los entornos; el host sale de cada
 * despliegue) y los tres campos dicen en qué claves del JSON viaja el mensaje, la respuesta y, si la hay, la sesión.
 */
export interface ChatConfig {
  /** empieza por `/`, p. ej. `/api/chat` */
  path: string;
  requestField: string;
  /** clave de la respuesta; admite ruta con puntos (`data.answer`) */
  responseField: string;
  /** clave que lleva el id de conversación en la petición y en la respuesta; null = el asistente no tiene sesiones */
  sessionField: string | null;
}

/** Lo que describe a un agente. Vive en el propio experimento: un experimento es un agente (ADR-054). */
export interface Assistant {
  experimentId: string;
  description: string;
  ownerUserId: string | null;
  lifecycle: AssistantLifecycle;
  /** null = el agente no declara endpoint de chat */
  chat: ChatConfig | null;
  createdAt: string;
  updatedAt: string;
}

export interface Deployment {
  id: string;
  experimentId: string;
  environmentId: string;
  apiUrl: string;
  /** null = `apiUrl` + `/health` */
  healthUrl: string | null;
  version: string | null;
  authMethod: AuthMethod;
  authProvider: string | null;
  authAudience: string | null;
  healthCheckEnabled: boolean;
  /** null = el intervalo del entorno */
  healthIntervalSeconds: number | null;
  healthStatus: HealthStatus;
  healthCheckedAt: string | null;
  healthStatusSince: string | null;
  healthLatencyMs: number | null;
  healthConsecutiveFailures: number;
}

export interface HealthCheck {
  deploymentId: string;
  checkedAt: string;
  status: HealthStatus;
  latencyMs: number | null;
  httpStatus: number | null;
  error: string | null;
}

export interface Connection {
  id: string;
  experimentId: string;
  kind: ConnectionKind;
  name: string;
  via: string | null;
  peerExperimentId: string | null;
  declared: boolean;
  status: ConnectionStatus;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
}

export interface AccessGrant {
  id: string;
  deploymentId: string;
  subjectType: GrantSubjectType;
  userId: string | null;
  /** quién es, cuando el acceso es de una persona; null en grupos y "todos" */
  user: AssistantPerson | null;
  externalGroup: string | null;
  memberCount: number | null;
  source: GrantSource;
  syncedAt: string | null;
}

/** Persona de la organización a la que se le puede dar acceso: lo justo para elegirla y mostrarla. */
export interface AssistantPerson {
  userId: string;
  name: string | null;
  email: string;
  /** URL de la foto del proveedor de identidad; null si no tiene */
  image: string | null;
}

/** URL de /health de un despliegue: la propia si la tiene, y si no `apiUrl` sin barra final + `/health`. */
export function resolveHealthUrl(deployment: Pick<Deployment, "apiUrl" | "healthUrl">): string {
  return deployment.healthUrl ?? `${deployment.apiUrl.replace(/\/+$/, "")}/health`;
}

/** URL de chat de un despliegue: su host (`apiUrl`, sin barra final) + el path del agente. */
export function resolveChatUrl(deployment: Pick<Deployment, "apiUrl">, chat: Pick<ChatConfig, "path">): string {
  return `${deployment.apiUrl.replace(/\/+$/, "")}${chat.path}`;
}

/** Valor de una clave del JSON, con ruta de puntos (`data.answer`); undefined si no existe. */
export function readPath(body: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (value !== null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined), body);
}

/** Cuerpo que se envía al asistente según su contrato. */
export function buildChatRequest(chat: ChatConfig, message: string, sessionId: string | null): Record<string, string> {
  const body: Record<string, string> = { [chat.requestField]: message };
  if (chat.sessionField !== null && sessionId) body[chat.sessionField] = sessionId;
  return body;
}

/** Extrae la respuesta y la sesión del JSON del asistente; `reply` null si la clave no existe o no es texto. */
export function parseChatResponse(chat: ChatConfig, body: unknown): { reply: string | null; sessionId: string | null } {
  const reply = readPath(body, chat.responseField);
  const session = chat.sessionField === null ? null : readPath(body, chat.sessionField);
  return { reply: typeof reply === "string" ? reply : null, sessionId: typeof session === "string" ? session : null };
}

/** Tamaño máximo del mensaje del panel. */
export const MAX_CHAT_MESSAGE_LENGTH = 8000;

const FIELD = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

export function validateChatConfig(chat: ChatConfig): void {
  const errors: Record<string, string> = {};
  if (!chat.path.startsWith("/") || chat.path.startsWith("//") || /[\s?#]/.test(chat.path) || chat.path.length > 300) {
    errors.path = "Must start with a single / and have no spaces, query or fragment";
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(chat.requestField)) errors.requestField = "Must be a plain JSON key";
  if (!FIELD.test(chat.responseField)) errors.responseField = "Must be a JSON key or a dotted path";
  if (chat.sessionField !== null && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(chat.sessionField)) errors.sessionField = "Must be a plain JSON key";
  if (Object.keys(errors).length > 0) throw new ValidationError("Invalid chat endpoint", errors);
}

/**
 * Primera barrera contra SSRF: solo http(s), sin credenciales en la URL. El bloqueo de IPs privadas, loopback y metadata
 * de la nube necesita resolver el DNS, así que lo hace el worker justo antes de cada sondeo (ADR-053).
 */
export function isProbeableUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (url.protocol === "http:" || url.protocol === "https:") && url.username === "" && url.password === "";
}

const STATUS_SEVERITY: Record<HealthStatus, number> = { down: 3, degraded: 2, unknown: 1, up: 0 };

/** Estado global de un asistente: el peor de sus despliegues. Sin despliegues no hay estado (`null`). */
export function overallStatus(deployments: Pick<Deployment, "healthStatus">[]): HealthStatus | null {
  if (deployments.length === 0) return null;
  return deployments.reduce<HealthStatus>((worst, d) => (STATUS_SEVERITY[d.healthStatus] > STATUS_SEVERITY[worst] ? d.healthStatus : worst), "up");
}

/** Intervalo efectivo de sondeo: el del despliegue, o el de su entorno. */
export function effectiveIntervalSeconds(deployment: Pick<Deployment, "healthIntervalSeconds">, environment: Pick<Environment, "healthIntervalSeconds">): number {
  return Math.max(deployment.healthIntervalSeconds ?? environment.healthIntervalSeconds, MIN_HEALTH_INTERVAL_SECONDS);
}

/** ¿Toca sondear este despliegue? Nunca sondeado, o ya pasó su intervalo. */
export function isDueForCheck(
  deployment: Pick<Deployment, "healthCheckEnabled" | "healthCheckedAt" | "healthIntervalSeconds">,
  environment: Pick<Environment, "healthIntervalSeconds">,
  now: Date,
): boolean {
  if (!deployment.healthCheckEnabled) return false;
  if (deployment.healthCheckedAt === null) return true;
  return now.getTime() - new Date(deployment.healthCheckedAt).getTime() >= effectiveIntervalSeconds(deployment, environment) * 1000;
}

/** Deriva: se vio en trazas y nadie lo ha aprobado ni bloqueado. */
export function needsReview(connection: Pick<Connection, "firstSeenAt" | "status">): boolean {
  return connection.firstSeenAt !== null && connection.status === "pending";
}

/** Declarada pero sin verse desde `sinceDays` días (o nunca): candidata a limpiar. */
export function isStaleDeclaration(connection: Pick<Connection, "declared" | "lastSeenAt">, now: Date, sinceDays = 30): boolean {
  if (!connection.declared) return false;
  return connection.lastSeenAt === null || now.getTime() - new Date(connection.lastSeenAt).getTime() > sinceDays * 86_400_000;
}

// ── Lecturas compuestas ────────────────────────────────────────────────────────────────────────────────────────

export interface EnvironmentRef {
  id: string;
  key: string;
  label: string;
  position: number;
  isProduction: boolean;
  healthIntervalSeconds: number;
}

/** Quién puede llamar a un despliegue, resumido para la tarjeta. */
export interface AccessSummary {
  everyone: boolean;
  groups: number;
  users: number;
}

/** Persona que participa en el experimento (técnica o de negocio), para la foto de la tarjeta. */
export interface AssistantMember {
  userId: string;
  name: string | null;
  email: string;
  /** URL de la foto del proveedor de identidad; null si no tiene */
  image: string | null;
  /** rol en el experimento: `technical`, `business` u otro */
  role: string;
}

/** Cuántas personas se adelantan en la tarjeta; `total` cuenta a todas. */
export const MEMBER_PREVIEW = 4;

/** Disponibilidad de las últimas 24 h en tramos iguales (el más antiguo primero); `null` = sin sondeos en el tramo. */
export const RECENT_BUCKETS = 36;
export interface RecentHealth {
  buckets: Array<HealthStatus | null>;
  /** % de sondeos que no fueron `down`; null sin sondeos */
  uptimePercent: number | null;
}

export interface DeploymentSummary extends Deployment {
  environment: EnvironmentRef;
  access: AccessSummary;
  recent: RecentHealth;
}

export interface ConnectionCounts {
  mcpServers: number;
  tools: number;
  agents: number;
  /** vistas en trazas y aún sin aprobar ni bloquear */
  toReview: number;
}

/** Ficha del asistente tal como la muestra el catálogo y la cabecera del detalle. */
export interface AssistantCard extends Assistant {
  /** nombre del experimento */
  name: string;
  serviceName: string;
  owner: { id: string; name: string | null; email: string; image: string | null } | null;
  deployments: DeploymentSummary[];
  connectionCounts: ConnectionCounts;
  /** nombres de sus servidores MCP (declarados u observados), para los chips de la tarjeta */
  mcpServerNames: string[];
  /** quién participa en el experimento: primero el equipo técnico, luego negocio */
  members: { total: number; preview: AssistantMember[] };
  /** el peor estado de sus despliegues; null si no tiene ninguno */
  status: HealthStatus | null;
}

// ── Entradas ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Ficha que se da al crear el experimento (todo opcional salvo lo que ponga quien lo crea). */
export interface AgentProfile {
  description: string;
  ownerUserId: string | null;
}
export type AssistantPatch = Partial<AgentProfile> & { lifecycle?: AssistantLifecycle; chat?: ChatConfig | null };

export interface NewDeployment {
  environmentKey: string;
  apiUrl: string;
  healthUrl: string | null;
  version: string | null;
  authMethod: AuthMethod;
  authProvider: string | null;
  authAudience: string | null;
  healthCheckEnabled: boolean;
  healthIntervalSeconds: number | null;
}
export type DeploymentPatch = Partial<Omit<NewDeployment, "environmentKey">>;

export interface NewGrant {
  subjectType: GrantSubjectType;
  userId?: string | null;
  externalGroup?: string | null;
  memberCount?: number | null;
}

export interface DeclaredConnection {
  kind: ConnectionKind;
  name: string;
  via?: string | null;
  peerExperimentId?: string | null;
}

/** Lo que el sincronizador vio en trazas. */
export interface ObservedConnection {
  kind: ConnectionKind;
  name: string;
  via?: string | null;
}

/** Una conexión con su uso observado (ClickHouse). `null` donde todavía no se mide (agentes). */
export interface ConnectionWithUsage extends Connection {
  usage: { calls: number; errors: number } | null;
}

/** Despliegue que el worker debe sondear ahora. */
export interface ProbeTarget {
  deploymentId: string;
  url: string;
  status: HealthStatus;
  statusSince: string | null;
  consecutiveFailures: number;
}

// ── Validación ─────────────────────────────────────────────────────────────────────────────────────────────────

const AUTH_METHODS: readonly AuthMethod[] = ["none", "api_key", "oauth2", "mtls", "other"];
export const isAuthMethod = (v: string): v is AuthMethod => (AUTH_METHODS as readonly string[]).includes(v);

function checkDeploymentFields(fields: Partial<NewDeployment>): void {
  const errors: Record<string, string> = {};
  if (fields.apiUrl !== undefined && !isProbeableUrl(fields.apiUrl)) errors.apiUrl = "Must be an http(s) URL without credentials";
  if (fields.healthUrl != null && !isProbeableUrl(fields.healthUrl)) errors.healthUrl = "Must be an http(s) URL without credentials";
  if (fields.healthIntervalSeconds != null && fields.healthIntervalSeconds < MIN_HEALTH_INTERVAL_SECONDS) {
    errors.healthIntervalSeconds = `Must be at least ${MIN_HEALTH_INTERVAL_SECONDS} seconds`;
  }
  if (fields.authMethod !== undefined && !isAuthMethod(fields.authMethod)) errors.authMethod = "Unknown authentication method";
  if (Object.keys(errors).length > 0) throw new ValidationError("Invalid deployment", errors);
}
export const validateNewDeployment = (input: NewDeployment): void => checkDeploymentFields(input);
export const validateDeploymentPatch = (patch: DeploymentPatch): void => checkDeploymentFields(patch);

export function validateNewGrant(grant: NewGrant): void {
  const user = grant.userId ?? null;
  const group = grant.externalGroup?.trim() || null;
  const ok =
    (grant.subjectType === "user" && user !== null && group === null) ||
    (grant.subjectType === "group" && group !== null && user === null) ||
    (grant.subjectType === "everyone" && user === null && group === null);
  if (!ok) throw new ValidationError("Invalid access grant", { subjectType: "A user needs userId, a group needs externalGroup, everyone needs neither" });
}

export function validateDeclaredConnection(c: DeclaredConnection): void {
  const errors: Record<string, string> = {};
  if (c.name.trim() === "") errors.name = "Required";
  if (c.via != null && c.kind !== "tool") errors.via = "Only tools have a via";
  if (c.peerExperimentId != null && c.kind !== "agent") errors.peerExperimentId = "Only agents can point to a catalog assistant";
  if (Object.keys(errors).length > 0) throw new ValidationError("Invalid connection", errors);
}

// ── Sondeo de /health ──────────────────────────────────────────────────────────────────────────────────────────

/** Respuesta del sondeo, tal cual la midió el worker. `httpStatus` null = no hubo respuesta (timeout, DNS, conexión). */
export interface ProbeResult {
  httpStatus: number | null;
  latencyMs: number | null;
  error: string | null;
}

/** Por encima de esta latencia un /health 2xx cuenta como degradado. */
export const DEGRADED_LATENCY_MS = 1500;
/** Fallos seguidos necesarios para pasar a `down` (un fallo suelto no tumba el estado). */
export const FAILURES_BEFORE_DOWN = 2;

/** 2xx rápido = up; 2xx lento = degraded; cualquier otra cosa (sin respuesta, 3xx, 4xx, 5xx) = down. El /health es abierto: un 401 es un error de configuración. */
export function classifyProbe(result: ProbeResult): HealthStatus {
  if (result.httpStatus === null || result.error !== null) return "down";
  if (result.httpStatus < 200 || result.httpStatus >= 300) return "down";
  return result.latencyMs !== null && result.latencyMs > DEGRADED_LATENCY_MS ? "degraded" : "up";
}

export interface HealthState {
  status: HealthStatus;
  statusSince: string | null;
  consecutiveFailures: number;
}

/**
 * Nuevo estado del despliegue tras un sondeo. El historial guarda el resultado en bruto; el estado actual espera
 * `FAILURES_BEFORE_DOWN` fallos seguidos antes de pasar a `down` (salvo que ya lo estuviera o aún no se conociera).
 */
export function applyProbe(current: HealthState, probed: HealthStatus, checkedAt: string): HealthState {
  const failures = probed === "down" ? current.consecutiveFailures + 1 : 0;
  const holdPrevious = probed === "down" && failures < FAILURES_BEFORE_DOWN && current.status !== "down";
  const status = holdPrevious ? current.status : probed;
  return { status, statusSince: status === current.status ? current.statusSince ?? checkedAt : checkedAt, consecutiveFailures: failures };
}

// ── Direcciones que el sondeo nunca debe alcanzar (SSRF) ───────────────────────────────────────────────────────

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return nums.every((n) => n >= 0 && n <= 255) ? nums : null;
}

/** link-local (metadata de la nube) y el resto de rangos no públicos, que se distinguen para poder permitir solo los privados. */
function ipv4Class(n: number[]): "link-local" | "private" | "public" {
  const [a, b] = [n[0]!, n[1]!];
  if (a === 169 && b === 254) return "link-local";
  if (a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "private";
  if ((a === 192 && b === 0 && n[2] === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224) return "private";
  return "public";
}

/**
 * ¿Es una dirección a la que el worker no debe conectar? Bloquea loopback, redes privadas, CGNAT, multicast y reservadas
 * (IPv4 e IPv6, incluidas las IPv4 mapeadas en IPv6). Con `allowPrivateNetworks` (entornos de desarrollo, o una organización
 * cuyos asistentes viven en su red interna) se permiten las privadas y el loopback, pero **nunca** link-local: ahí está el
 * servicio de metadata de la nube (169.254.169.254, fe80::).
 */
export function isBlockedAddress(address: string, options: { allowPrivateNetworks?: boolean } = {}): boolean {
  const ip = address.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  const v4 = parseIPv4(mapped ?? ip);
  if (v4) {
    const kind = ipv4Class(v4);
    return kind === "link-local" || (kind === "private" && !options.allowPrivateNetworks);
  }
  if (!ip.includes(":")) return true; // ni IPv4 ni IPv6: no se conecta
  if (/^fe[89ab]/.test(ip)) return true; // link-local fe80::/10
  if (ip === "::1" || ip === "::") return !options.allowPrivateNetworks;
  if (/^f[cd]/.test(ip) || ip.startsWith("ff")) return !options.allowPrivateNetworks; // únicas locales fc00::/7 y multicast
  return false;
}
