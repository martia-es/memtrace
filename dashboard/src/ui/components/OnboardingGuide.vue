<script setup lang="ts">
import { ref, computed } from "vue";

type Framework = "langchain" | "langgraph" | "pydantic-ai";
type Language = "python" | "typescript";

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).then(() => {
    console.log("Copied to clipboard");
  });
}

const selectedFramework = ref<Framework>("langchain");
const selectedLanguage = ref<Language>("python");

interface SetupStep {
  title: string;
  content: string;
}

interface SetupGuide {
  install: SetupStep;
  envVars: SetupStep;
  example: SetupStep;
}

const setupGuides: Record<`${Framework}-${Language}`, SetupGuide> = {
  "langchain-python": {
    install: {
      title: "1. Instalar el SDK",
      content: "pip install memtrace-ai[langchain]",
    },
    envVars: {
      title: "2. Variables de entorno",
      content: `export MEMTRACE_SERVICE_NAME="mi-agente"
export MEMTRACE_OTLP_ENDPOINT="http://localhost:4317"
export MEMTRACE_CAPTURE_CONTENT="true"`,
    },
    example: {
      title: "3. Usar en tu código",
      content: `from memtrace import init_tracer, MemTraceCallbackHandler, session
from langchain.tools import tool
from langchain.agents import create_agent

init_tracer(service_name="mi-agente")

@tool
def search(query: str) -> str:
    """Search for information."""
    return f"Results for: {query}"

agent = create_agent(
    model="openai:gpt-4",
    tools=[search],
    system_prompt="You are a helpful assistant."
)

conversation_id = "chat-123"
config = {
    "callbacks": [MemTraceCallbackHandler()],
    "metadata": {"thread_id": conversation_id},
}

with session(conversation_id):
    result = agent.invoke(
        {"input": "What's the weather?"},
        config=config
    )`,
    },
  },
  "langchain-typescript": {
    install: {
      title: "1. Instalar el SDK",
      content: "npm install memtrace-ai",
    },
    envVars: {
      title: "2. Variables de entorno",
      content: `export MEMTRACE_SERVICE_NAME="mi-agente"
export MEMTRACE_OTLP_ENDPOINT="http://localhost:4317"
export MEMTRACE_CAPTURE_CONTENT="true"`,
    },
    example: {
      title: "3. Usar en tu código",
      content: `import { initTracer, MemTraceCallbackHandler, session } from "memtrace-ai";
import { createAgent } from "langchain/agents";
import { tool } from "@langchain/core/tools";

initTracer({ serviceName: "mi-agente" });

const search = tool(
  async (query: string) => {
    return \`Results for: \${query}\`;
  },
  {
    name: "search",
    description: "Search for information.",
  }
);

const agent = await createAgent({
  model: "gpt-4",
  tools: [search],
  systemPrompt: "You are a helpful assistant."
});

const conversationId = "chat-123";
const config = {
  callbacks: [new MemTraceCallbackHandler()],
  metadata: { threadId: conversationId }
};

await session(conversationId, async () => {
  const result = await agent.invoke(
    { input: "What's the weather?" },
    config
  );
});`,
    },
  },
  "langgraph-python": {
    install: {
      title: "1. Instalar el SDK",
      content: "pip install memtrace-ai[langchain]",
    },
    envVars: {
      title: "2. Variables de entorno",
      content: `export MEMTRACE_SERVICE_NAME="mi-agente"
export MEMTRACE_OTLP_ENDPOINT="http://localhost:4317"
export MEMTRACE_CAPTURE_CONTENT="true"`,
    },
    example: {
      title: "3. Usar en tu código",
      content: `from memtrace import init_tracer, MemTraceCallbackHandler, session
from langgraph.graph import StateGraph
from langchain.tools import tool

init_tracer(service_name="mi-agente")

@tool
def search(query: str) -> str:
    """Search for information."""
    return f"Results for: {query}"

def agent_step(state):
    # Tu lógica del agente
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
    result = graph.invoke(
        {"input": "What's the weather?"},
        config=config
    )`,
    },
  },
  "langgraph-typescript": {
    install: {
      title: "1. Instalar el SDK",
      content: "npm install memtrace-ai",
    },
    envVars: {
      title: "2. Variables de entorno",
      content: `export MEMTRACE_SERVICE_NAME="mi-agente"
export MEMTRACE_OTLP_ENDPOINT="http://localhost:4317"
export MEMTRACE_CAPTURE_CONTENT="true"`,
    },
    example: {
      title: "3. Usar en tu código",
      content: `import { initTracer, MemTraceCallbackHandler, session } from "memtrace-ai";
import { StateGraph } from "@langchain/langgraph";
import { tool } from "@langchain/core/tools";

initTracer({ serviceName: "mi-agente" });

const search = tool(
  async (query: string) => {
    return \`Results for: \${query}\`;
  },
  {
    name: "search",
    description: "Search for information.",
  }
);

const builder = new StateGraph({
  channels: { input: { value: null } }
});

builder.addNode("agent", async (state) => state);
builder.setEntryPoint("agent");
const graph = builder.compile();

const conversationId = "chat-123";
const config = {
  callbacks: [new MemTraceCallbackHandler()],
  metadata: { threadId: conversationId }
};

await session(conversationId, async () => {
  const result = await graph.invoke(
    { input: "What's the weather?" },
    config
  );
});`,
    },
  },
  "pydantic-ai-python": {
    install: {
      title: "1. Instalar el SDK",
      content: "pip install memtrace-ai",
    },
    envVars: {
      title: "2. Variables de entorno",
      content: `export MEMTRACE_SERVICE_NAME="mi-agente"
export MEMTRACE_OTLP_ENDPOINT="http://localhost:4317"
export MEMTRACE_CAPTURE_CONTENT="true"`,
    },
    example: {
      title: "3. Usar en tu código",
      content: `from memtrace import init_tracer, session, trace_step
from pydantic_ai import Agent

init_tracer(service_name="mi-agente")

agent = Agent(
    "openai:gpt-4",
    system_prompt="You are a helpful assistant."
)

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
  },
  "pydantic-ai-typescript": {
    install: {
      title: "1. Instalar el SDK",
      content: "npm install memtrace-ai pydantic-ai",
    },
    envVars: {
      title: "2. Variables de entorno",
      content: `export MEMTRACE_SERVICE_NAME="mi-agente"
export MEMTRACE_OTLP_ENDPOINT="http://localhost:4317"
export MEMTRACE_CAPTURE_CONTENT="true"`,
    },
    example: {
      title: "3. Usar en tu código",
      content: `import { initTracer, session, traceStep } from "memtrace-ai";
import { Agent } from "pydantic-ai";

initTracer({ serviceName: "mi-agente" });

const agent = new Agent({
  model: "openai:gpt-4",
  systemPrompt: "You are a helpful assistant."
});

agent.tool(
  "search",
  async (query: string) => {
    return "The weather is sunny!";
  },
  { description: "Get weather for a city." }
);

const ask = traceStep(
  "ask",
  async (prompt: string) => {
    return await agent.run(prompt);
  }
);

const conversationId = "chat-123";
await session(conversationId, async () => {
  const result = await ask("What's the weather?");
});`,
    },
  },
};

const currentGuide = computed(() => {
  const key = `${selectedFramework.value}-${selectedLanguage.value}` as const;
  return setupGuides[key];
});
</script>

<template>
  <div class="onboarding">
    <div class="header">
      <q-icon name="rocket_launch" size="48px" class="icon" />
      <div class="text">
        <h2>No traces detected yet</h2>
        <p>Follow our guide to start tracing your application</p>
      </div>
    </div>

    <div class="selectors">
      <div class="selector-group">
        <label>Framework</label>
        <div class="buttons">
          <button
            v-for="fw in ['langchain', 'langgraph', 'pydantic-ai'] as const"
            :key="fw"
            :class="{ active: selectedFramework === fw }"
            @click="selectedFramework = fw"
          >
            {{ fw === "pydantic-ai" ? "PydanticAI" : fw.charAt(0).toUpperCase() + fw.slice(1) }}
          </button>
        </div>
      </div>

      <div class="selector-group">
        <label>Language</label>
        <div class="buttons">
          <button
            v-for="lang in ['python', 'typescript'] as const"
            :key="lang"
            :class="{ active: selectedLanguage === lang }"
            @click="selectedLanguage = lang"
          >
            {{ lang.charAt(0).toUpperCase() + lang.slice(1) }}
          </button>
        </div>
      </div>
    </div>

    <div class="steps">
      <div class="step">
        <div class="step-title">{{ currentGuide.install.title }}</div>
        <div class="code-block">
          <pre><code>{{ currentGuide.install.content }}</code></pre>
          <button class="copy-btn" title="Copy to clipboard" @click="copyToClipboard(currentGuide.install.content)">
            <q-icon name="content_copy" size="16px" />
          </button>
        </div>
      </div>

      <div class="step">
        <div class="step-title">{{ currentGuide.envVars.title }}</div>
        <div class="code-block">
          <pre><code>{{ currentGuide.envVars.content }}</code></pre>
          <button class="copy-btn" title="Copy to clipboard" @click="copyToClipboard(currentGuide.envVars.content)">
            <q-icon name="content_copy" size="16px" />
          </button>
        </div>
      </div>

      <div class="step">
        <div class="step-title">{{ currentGuide.example.title }}</div>
        <div class="code-block">
          <pre><code>{{ currentGuide.example.content }}</code></pre>
          <button class="copy-btn" title="Copy to clipboard" @click="copyToClipboard(currentGuide.example.content)">
            <q-icon name="content_copy" size="16px" />
          </button>
        </div>
      </div>
    </div>

    <div class="footer-note">
      <p>
        <strong>Tip:</strong> Point your OTLP endpoint to <code>http://localhost:4317</code> to send traces locally.
        Ensure the MemTrace backend is running: <code>make up</code>
      </p>
    </div>
  </div>
</template>

<style scoped>
.onboarding {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 40px;
  background: var(--mt-card);
  border-radius: 12px;
  margin: 20px auto;
  max-width: 900px;
}

.header {
  display: flex;
  align-items: center;
  gap: 20px;
  text-align: left;
}

.icon {
  flex-shrink: 0;
  color: #7fcf4a;
}

.header h2 {
  margin: 0 0 4px 0;
  font-size: 24px;
  font-weight: 700;
  color: var(--mt-ink);
}

.header p {
  margin: 0;
  font-size: 14px;
  color: var(--mt-muted);
}

.selectors {
  display: flex;
  gap: 32px;
  flex-wrap: wrap;
}

.selector-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.selector-group label {
  font-size: 12px;
  font-weight: 600;
  color: var(--mt-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.buttons {
  display: flex;
  gap: 8px;
}

.buttons button {
  padding: 8px 16px;
  border: 1px solid var(--mt-line);
  border-radius: 8px;
  background: var(--mt-soft);
  color: var(--mt-ink);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 200ms ease;
}

.buttons button:hover {
  border-color: #7fcf4a;
  background: rgba(127, 207, 74, 0.08);
}

.buttons button.active {
  border-color: #7fcf4a;
  background: #7fcf4a;
  color: #fff;
}

.steps {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.step {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.step-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--mt-ink);
}

.code-block {
  position: relative;
  background: #1a1a1a;
  border-radius: 8px;
  overflow: hidden;
}

.code-block pre {
  margin: 0;
  padding: 12px 16px;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.5;
}

.code-block code {
  color: #e0e0e0;
  font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
  white-space: pre;
}

.copy-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 6px;
  border: 1px solid rgba(224, 224, 224, 0.2);
  border-radius: 4px;
  background: rgba(30, 30, 30, 0.8);
  color: #e0e0e0;
  cursor: pointer;
  transition: all 200ms ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.copy-btn:hover {
  background: rgba(127, 207, 74, 0.2);
  border-color: #7fcf4a;
  color: #7fcf4a;
}

.footer-note {
  padding: 12px 16px;
  background: rgba(127, 207, 74, 0.08);
  border-left: 3px solid #7fcf4a;
  border-radius: 4px;
  font-size: 13px;
  color: var(--mt-ink);
}

.footer-note p {
  margin: 0;
}

.footer-note code {
  background: rgba(0, 0, 0, 0.1);
  padding: 2px 6px;
  border-radius: 3px;
  font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
  font-size: 12px;
}

@media (max-width: 768px) {
  .onboarding {
    padding: 24px;
  }

  .header {
    flex-direction: column;
    text-align: center;
  }

  .selectors {
    flex-direction: column;
    gap: 16px;
  }

  .buttons {
    flex-wrap: wrap;
  }
}
</style>
