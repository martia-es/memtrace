<script setup lang="ts">
import { ref, computed } from "vue";
import { useQuasar } from "quasar";
import { useIdentityApi } from "../composables/useIdentityApi";

const props = defineProps<{ serviceName: string; experimentId: string }>();

const $q = useQuasar();
const identityApi = useIdentityApi();

type Framework = "langchain" | "langgraph" | "pydantic-ai";
type Language = "python" | "typescript";

const selectedFramework = ref<Framework>("langchain");
const selectedLanguage = ref<Language>("python");
const copiedKey = ref<string | null>(null);

function copy(text: string, key: string) {
  void navigator.clipboard.writeText(text);
  copiedKey.value = key;
  setTimeout(() => {
    if (copiedKey.value === key) copiedKey.value = null;
  }, 1500);
}

// API key generated right here (ADR-013, pieza 9): solo vive en memoria del componente, se ve una vez.
const generatedApiKey = ref<string | null>(null);
const generatingApiKey = ref(false);
async function generateApiKey() {
  generatingApiKey.value = true;
  try {
    const created = await identityApi.createApiKey(props.experimentId);
    generatedApiKey.value = created.plaintext;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    $q.notify({ message: `No se pudo generar la API key: ${detail}`, color: "negative", timeout: 4000 });
  } finally {
    generatingApiKey.value = false;
  }
}

function buildEnv(serviceName: string, apiKey: string | null): string {
  const ingestUrl = `${window.location.origin}/api/v1/ingest`;
  const bearer = apiKey ?? "PEGA_AQUI_TU_API_KEY";
  return `MEMTRACE_SERVICE_NAME="${serviceName || "my-agent"}"
MEMTRACE_OTLP_PROTOCOL="http"
MEMTRACE_OTLP_ENDPOINT="${ingestUrl}"
MEMTRACE_OTLP_HEADERS="Authorization=Bearer ${bearer}"
MEMTRACE_CAPTURE_CONTENT="true"`;
}

interface SetupGuide {
  installLabel: string;
  install: string;
  example: string;
}

const setupGuides: Record<`${Framework}-${Language}`, SetupGuide> = {
  "langchain-python": {
    installLabel: "pip",
    install: "pip install memtrace-ai[langchain]",
    example: `from memtrace import init_tracer, MemTraceCallbackHandler, session
from langchain.agents import create_agent
from langchain.tools import tool

init_tracer(service_name="my-agent")

@tool
def search(query: str) -> str:
    """Search for information."""
    return f"Results for: {query}"

agent = create_agent(
    model="openai:gpt-4",
    tools=[search],
    system_prompt="You are helpful.",
)

conversation_id = "chat-123"
config = {
    "callbacks": [MemTraceCallbackHandler()],
    "metadata": {"thread_id": conversation_id},
}

with session(conversation_id):
    result = agent.invoke({"input": "What's the weather?"}, config=config)`,
  },
  "langchain-typescript": {
    installLabel: "npm",
    install: "npm install memtrace-ai langchain",
    example: `import { initTracer, MemTraceCallbackHandler, session } from "memtrace-ai";
import { createAgent } from "langchain/agents";
import { tool } from "@langchain/core/tools";

initTracer({ serviceName: "my-agent" });

const search = tool(
  async (query: string) => \`Results for: \${query}\`,
  { name: "search", description: "Search for information." },
);

const agent = await createAgent({
  model: "gpt-4",
  tools: [search],
  systemPrompt: "You are helpful.",
});

const conversationId = "chat-123";
const config = {
  callbacks: [new MemTraceCallbackHandler()],
  metadata: { threadId: conversationId },
};

await session(conversationId, async () => {
  await agent.invoke({ input: "What's the weather?" }, config);
});`,
  },
  "langgraph-python": {
    installLabel: "pip",
    install: "pip install memtrace-ai[langchain] langgraph",
    example: `from memtrace import init_tracer, MemTraceCallbackHandler, session
from langgraph.graph import StateGraph
from langchain.tools import tool

init_tracer(service_name="my-agent")

@tool
def search(query: str) -> str:
    """Search for information."""
    return f"Results for: {query}"

def agent_step(state):
    return state

builder = StateGraph(dict)
builder.add_node("agent", agent_step)
builder.set_entry_point("agent")
graph = builder.compile()

conversation_id = "chat-123"
config = {
    "callbacks": [MemTraceCallbackHandler()],
    "metadata": {"thread_id": conversation_id},
}

with session(conversation_id):
    result = graph.invoke({"input": "What's the weather?"}, config=config)`,
  },
  "langgraph-typescript": {
    installLabel: "npm",
    install: "npm install memtrace-ai langchain langgraph",
    example: `import { initTracer, MemTraceCallbackHandler, session } from "memtrace-ai";
import { StateGraph } from "@langchain/langgraph";
import { tool } from "@langchain/core/tools";

initTracer({ serviceName: "my-agent" });

const search = tool(
  async (query: string) => \`Results for: \${query}\`,
  { name: "search", description: "Search for information." },
);

const builder = new StateGraph({ channels: { input: { value: null } } });
builder.addNode("agent", async (state) => state);
builder.setEntryPoint("agent");
const graph = builder.compile();

const conversationId = "chat-123";
const config = {
  callbacks: [new MemTraceCallbackHandler()],
  metadata: { threadId: conversationId },
};

await session(conversationId, async () => {
  await graph.invoke({ input: "What's the weather?" }, config);
});`,
  },
  "pydantic-ai-python": {
    installLabel: "pip",
    install: "pip install memtrace-ai pydantic-ai",
    example: `from memtrace import init_tracer, session, trace_step
from pydantic_ai import Agent

init_tracer(service_name="my-agent")

agent = Agent("openai:gpt-4", system_prompt="You are a helpful assistant.")

@agent.tool_plain
@trace_step(name="search", step_type="tool")
def search(query: str) -> str:
    """Get weather for a city."""
    return "The weather is sunny!"

@trace_step(name="ask", step_type="agent")
def ask(prompt: str) -> str:
    return agent.run_sync(prompt).output

conversation_id = "chat-123"
with session(conversation_id):
    result = ask("What's the weather?")`,
  },
  "pydantic-ai-typescript": {
    installLabel: "npm",
    install: "npm install memtrace-ai pydantic-ai",
    example: `import { initTracer, session, traceStep } from "memtrace-ai";
import { Agent } from "pydantic-ai";
import Card from "./Card.vue";

initTracer({ serviceName: "my-agent" });

const agent = new Agent({
  model: "openai:gpt-4",
  systemPrompt: "You are a helpful assistant.",
});

agent.tool(
  "search",
  async (query: string) => "The weather is sunny!",
  { description: "Get weather for a city." },
);

const ask = traceStep("ask", async (prompt: string) => agent.run(prompt));

const conversationId = "chat-123";
await session(conversationId, async () => {
  await ask("What's the weather?");
});`,
  },
};

const FRAMEWORKS: { id: Framework; label: string }[] = [
  { id: "langchain", label: "LangChain" },
  { id: "langgraph", label: "LangGraph" },
  { id: "pydantic-ai", label: "PydanticAI" },
];

const LANGUAGES: { id: Language; label: string }[] = [
  { id: "python", label: "Python" },
  { id: "typescript", label: "TypeScript" },
];

// las plantillas usan "my-agent" como placeholder fijo: se sustituye por el service.name real del experimento
const guide = computed(() => {
  const base = setupGuides[`${selectedFramework.value}-${selectedLanguage.value}`];
  const example = props.serviceName ? base.example.replaceAll("my-agent", props.serviceName) : base.example;
  return { ...base, env: buildEnv(props.serviceName, generatedApiKey.value), example };
});
</script>

<template>
  <Card padding="none" block class="onboarding">
    <div class="intro">
      <q-icon name="forum" size="32px" class="intro-icon" />
      <div class="intro-title">No traces detected yet</div>
      <div class="intro-sub">Follow this guide to start tracing your application.</div>
    </div>

    <div class="pickers">
      <div class="picker">
        <span class="picker-label">Framework</span>
        <div class="mt-segmented">
          <button
            v-for="fw in FRAMEWORKS"
            :key="fw.id"
            type="button"
            :aria-pressed="selectedFramework === fw.id"
            @click="selectedFramework = fw.id"
          >
            {{ fw.label }}
          </button>
        </div>
      </div>

      <div class="picker">
        <span class="picker-label">Language</span>
        <div class="mt-segmented">
          <button
            v-for="lang in LANGUAGES"
            :key="lang.id"
            type="button"
            :aria-pressed="selectedLanguage === lang.id"
            @click="selectedLanguage = lang.id"
          >
            {{ lang.label }}
          </button>
        </div>
      </div>
    </div>

    <ol class="steps">
      <li class="step">
        <span class="step-label">Install</span>
        <div class="snippet">
          <pre><code>{{ guide.install }}</code></pre>
          <button class="copy" type="button" title="Copy" @click="copy(guide.install, 'install')">
            <q-icon :name="copiedKey === 'install' ? 'check' : 'content_copy'" size="15px" />
          </button>
        </div>
      </li>

      <li class="step">
        <div class="step-header">
          <span class="step-label">Set environment variables</span>
          <button class="generate-key-btn" type="button" :disabled="generatingApiKey" @click="generateApiKey">
            {{ generatedApiKey ? "Generate another API key" : "Generate API key" }}
          </button>
        </div>
        <p v-if="generatedApiKey" class="key-warning">
          Copy it now — it won't be shown in full again. If you leave this screen you'll need to generate a new one.
        </p>
        <div class="snippet">
          <pre><code>{{ guide.env }}</code></pre>
          <button class="copy" type="button" title="Copy" @click="copy(guide.env, 'env')">
            <q-icon :name="copiedKey === 'env' ? 'check' : 'content_copy'" size="15px" />
          </button>
        </div>
      </li>

      <li class="step">
        <span class="step-label">Instrument your agent</span>
        <div class="snippet">
          <pre><code>{{ guide.example }}</code></pre>
          <button class="copy" type="button" title="Copy" @click="copy(guide.example, 'example')">
            <q-icon :name="copiedKey === 'example' ? 'check' : 'content_copy'" size="15px" />
          </button>
        </div>
      </li>
    </ol>
  </Card>
</template>

<style scoped>
.onboarding {
  margin: 8px auto;
  padding: 32px;
  max-width: 720px;
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.intro {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 4px;
  color: var(--mt-muted);
}
.intro-icon {
  color: var(--mt-muted);
  margin-bottom: 4px;
}
.intro-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--mt-ink);
  letter-spacing: -0.01em;
}
.intro-sub {
  font-size: 13px;
}

.pickers {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 24px;
}
.picker {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.picker-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--mt-faint);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.step {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.step-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--mt-ink);
}
.step-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.generate-key-btn {
  flex-shrink: 0;
  height: 30px;
  padding: 0 14px;
  border-radius: var(--mt-radius-lg);
  border: none;
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.generate-key-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.key-warning {
  margin: -2px 0 0;
  font-size: 12px;
  color: var(--mt-warn-ink);
}

.snippet {
  position: relative;
  background: var(--code-bg);
  border-radius: var(--mt-radius-lg);
}
.snippet pre {
  margin: 0;
  padding: 12px 40px 12px 14px;
  overflow-x: auto;
}
.snippet code {
  background: transparent;
  padding: 0;
  font-family: var(--mt-mono);
  font-size: 12px;
  line-height: 1.6;
  color: var(--mt-ink);
  white-space: pre;
}

.copy {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: var(--mt-radius-sm);
  background: var(--mt-card);
  color: var(--mt-muted);
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(20, 60, 35, 0.12);
}
.copy:hover {
  color: var(--mt-ink);
}

@media (max-width: 560px) {
  .onboarding {
    padding: 24px 16px;
  }
  .pickers {
    gap: 16px;
  }
}
</style>
