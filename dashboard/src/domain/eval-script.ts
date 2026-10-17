import { tr } from "./translate";
/** Genera el script y el `.env` de una evaluación offline desde el dashboard. Sin Vue ni HTTP. */

export type EvalMetricId = "exact_match" | "contains" | "correctness";

export interface EvalMetric {
  id: EvalMetricId;
  group: "rules" | "judge";
  label: string;
  description: string;
  /** expresión Python que se pasa a `evaluators=[...]` */
  python: string;
  needsJudge: boolean;
}

export const EVAL_METRICS: EvalMetric[] = [
  { id: "exact_match", group: "rules", label: "exact_match", get description() { return tr("eval-script.output_equals_expected"); }, python: "exact_match", needsJudge: false },
  { id: "contains", group: "rules", label: "contains", get description() { return tr("eval-script.expected_is_in_the_output"); }, python: "contains", needsJudge: false },
  { id: "correctness", group: "judge", label: "Correctness", get description() { return tr("eval-script.an_llm_judges_the_answer_vs"); }, python: "Correctness(client=AnthropicJudgeClient())", needsJudge: true },
];

/** Métricas que existen en el SDK pero no se pueden pedir aquí: el agente corre en otro proceso (se llama por HTTP). */
export const EVAL_METRICS_UNAVAILABLE = [
  { label: "Faithfulness", get reason() { return tr("eval-script.needs_the_retrieved_context_which_only"); } },
  { label: "Recall@k · MRR · HitRate", get reason() { return tr("eval-script.retrieval_is_captured_in_process_run"); } },
];

export interface EvalAgentTarget {
  /** etiqueta del entorno (DEV, PRE, PRO) */
  environment: string;
  /** apiUrl del despliegue + chat_path */
  url: string;
  requestField: string;
  /** clave o ruta con puntos (`data.answer`) */
  responseField: string;
  /** `auth_method` distinto de `none`: el script lee la cabecera `Authorization` del entorno */
  needsAuth: boolean;
}

export interface EvalScriptInput {
  /** `https://host` del dashboard: el API vive bajo `/api/v1` en el mismo origen */
  origin: string;
  experimentId: string;
  serviceName: string;
  datasetId: string;
  datasetName: string;
  /** `major.minor`; null = la última en el momento de ejecutar */
  version: string | null;
  metrics: EvalMetricId[];
  /** null = el agente no declara chat: el script deja una función para rellenar */
  agent: EvalAgentTarget | null;
}

const PLACEHOLDER_MEMTRACE_KEY = "PASTE_YOUR_MEMTRACE_API_KEY";
const PLACEHOLDER_ANTHROPIC_KEY = "PASTE_YOUR_ANTHROPIC_API_KEY";

export function selectedMetrics(ids: EvalMetricId[]): EvalMetric[] {
  return EVAL_METRICS.filter((m) => ids.includes(m.id));
}

export function needsJudge(ids: EvalMetricId[]): boolean {
  return selectedMetrics(ids).some((m) => m.needsJudge);
}

/** Nombre del run: legible y estable (dataset + versión + entorno). */
export function runName(input: Pick<EvalScriptInput, "datasetName" | "version" | "agent">): string {
  const slug = input.datasetName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "dataset";
  return [slug, input.version ?? "latest", input.agent?.environment.toLowerCase()].filter(Boolean).join("-");
}

/** Texto seguro dentro de un literal Python entre comillas dobles. */
function py(value: string): string {
  return JSON.stringify(value);
}

function agentFunction(agent: EvalAgentTarget | null): string {
  if (!agent) {
    return `def agent(*, item: EvalItem) -> str:
    # TODO: call your agent with item.input and return its answer as text.
    raise NotImplementedError("Edit agent() in run_eval.py to call your agent")`;
  }
  const headers = agent.needsAuth ? `, headers={"Authorization": os.environ["AGENT_AUTHORIZATION"]}` : "";
  const path = agent.responseField.split(".").filter(Boolean);
  const read = path.length <= 1 ? `body[${py(agent.responseField)}]` : `reduce(lambda part, key: part[key], ${JSON.stringify(path)}, body)`;
  return `def agent(*, item: EvalItem) -> str:
    # Contract of the agent: request field ${py(agent.requestField)}, response field ${py(agent.responseField)}
    response = httpx.post(os.environ["AGENT_URL"], json={${py(agent.requestField)}: item.input}, timeout=60.0${headers})
    response.raise_for_status()
    body = response.json()
    return ${read}`;
}

export function buildEvalScript(input: EvalScriptInput): string {
  const chosen = selectedMetrics(input.metrics);
  const judge = chosen.some((m) => m.needsJudge);
  const plain = chosen.filter((m) => !m.needsJudge).map((m) => m.python);
  const dotted = input.agent ? input.agent.responseField.split(".").filter(Boolean).length > 1 : false;
  const version = input.version ? `    dataset_version=${py(input.version)},\n` : "";
  const target = input.agent ? `${input.agent.environment}, ${input.agent.url}` : "agent to fill in";

  const imports = [
    "import os",
    ...(dotted ? ["from functools import reduce"] : []),
    "",
    ...(input.agent ? ["import httpx"] : []),
    "from dotenv import load_dotenv",
    "",
    "import memtrace",
    ...(judge ? ["from memtrace.adapters.outbound.llm.anthropic_client import AnthropicJudgeClient"] : []),
    `from memtrace.eval import EvalItem, ${[...plain].join(", ")}${plain.length ? ", " : ""}run_experiment`,
    ...(judge ? ["from memtrace.eval_judges import Correctness"] : []),
  ];

  const install = `pip install "memtrace-ai[eval]" ${input.agent ? "httpx " : ""}python-dotenv`;

  return `"""Offline evaluation of ${input.serviceName} on the dataset ${py(input.datasetName)} (${input.version ? `v${input.version}` : "latest version"}).

Generated by MemTrace. Target: ${target}.
    ${install}
    python run_eval.py
"""
${imports.join("\n")}

load_dotenv()
memtrace.init_tracer(service_name=os.environ["MEMTRACE_SERVICE_NAME"])


${agentFunction(input.agent)}


result = run_experiment(
    data=os.environ["MEMTRACE_DATASET_ID"],
${version}    task=agent,
    evaluators=[${chosen.map((m) => m.python).join(", ")}],
    name=${py(runName(input))},
)
memtrace.flush()

for summary in result.summary():
    print(summary)
`;
}

export function buildEvalEnv(input: EvalScriptInput): string {
  const api = `${input.origin}/api/v1/experiments/${input.experimentId}`;
  const lines = [
    "# MemTrace: dataset and results (key: Experiment > API keys)",
    `MEMTRACE_API_URL=${py(api)}`,
    `MEMTRACE_API_KEY=${py(PLACEHOLDER_MEMTRACE_KEY)}`,
    `MEMTRACE_DATASET_ID=${py(input.datasetId)}`,
    "",
    "# MemTrace: the trace of each item (latency, tokens and cost in the run)",
    `MEMTRACE_SERVICE_NAME=${py(input.serviceName)}`,
    `MEMTRACE_OTLP_PROTOCOL="http"`,
    `MEMTRACE_OTLP_ENDPOINT=${py(`${input.origin}/api/v1/ingest`)}`,
    `MEMTRACE_OTLP_HEADERS=${py(`Authorization=Bearer ${PLACEHOLDER_MEMTRACE_KEY}`)}`,
    `MEMTRACE_CAPTURE_CONTENT="true"`,
  ];
  if (input.agent) {
    lines.push("", `# Agent to evaluate (${input.agent.environment})`, `AGENT_URL=${py(input.agent.url)}`);
    if (input.agent.needsAuth) lines.push(`AGENT_AUTHORIZATION="Bearer PASTE_THE_AGENT_TOKEN"`);
  }
  if (needsJudge(input.metrics)) lines.push("", "# LLM judge (Correctness)", `ANTHROPIC_API_KEY=${py(PLACEHOLDER_ANTHROPIC_KEY)}`);
  return `${lines.join("\n")}\n`;
}

export function buildEvalInstall(input: Pick<EvalScriptInput, "agent">): string {
  return `python -m venv .venv && source .venv/bin/activate
pip install "memtrace-ai[eval]" ${input.agent ? "httpx " : ""}python-dotenv

# 1. Put your keys in .env (the PASTE_YOUR_... values)
# 2. Run it
python run_eval.py
`;
}

/** Variables del `.env` que el usuario todavía tiene que rellenar: se avisa de ellas en el modal. */
export function pendingSecrets(input: Pick<EvalScriptInput, "metrics" | "agent">): string[] {
  const secrets = ["MEMTRACE_API_KEY"];
  if (input.agent?.needsAuth) secrets.push("AGENT_AUTHORIZATION");
  if (needsJudge(input.metrics)) secrets.push("ANTHROPIC_API_KEY");
  return secrets;
}
