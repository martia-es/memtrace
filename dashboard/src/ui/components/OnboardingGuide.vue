<script setup lang="ts">
import { ref, computed } from "vue";

type Framework = "langchain" | "langgraph" | "pydantic-ai";
type Language = "python" | "typescript";
type TabKey = "install" | "env" | "example";

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).then(() => {
    console.log("Copied to clipboard");
  });
}

const selectedFramework = ref<Framework>("langchain");
const selectedLanguage = ref<Language>("python");
const activeTab = ref<TabKey>("install");

interface SetupStep {
  title: string;
  content: string;
}

interface SetupGuide {
  install: SetupStep;
  env: SetupStep;
  example: SetupStep;
}

const setupGuides: Record<`${Framework}-${Language}`, SetupGuide> = {
  "langchain-python": {
    install: {
      title: "pip",
      content: "pip install memtrace-ai[langchain]",
    },
    env: {
      title: "Shell",
      content: `export MEMTRACE_SERVICE_NAME="mi-agente"
export MEMTRACE_OTLP_ENDPOINT="http://localhost:4317"
export MEMTRACE_CAPTURE_CONTENT="true"`,
    },
    example: {
      title: "example.py",
      content: `from memtrace import init_tracer, MemTraceCallbackHandler, session
from langchain.agents import create_agent
from langchain.tools import tool

init_tracer(service_name="mi-agente")

@tool
def search(query: str) -> str:
    """Search for information."""
    return f"Results for: {query}"

agent = create_agent(
    model="openai:gpt-4",
    tools=[search],
    system_prompt="You are helpful."
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
      title: "npm",
      content: "npm install memtrace-ai langchain",
    },
    env: {
      title: "Shell",
      content: `export MEMTRACE_SERVICE_NAME="mi-agente"
export MEMTRACE_OTLP_ENDPOINT="http://localhost:4317"
export MEMTRACE_CAPTURE_CONTENT="true"`,
    },
    example: {
      title: "example.ts",
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
  systemPrompt: "You are helpful."
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
      title: "pip",
      content: "pip install memtrace-ai[langchain] langgraph",
    },
    env: {
      title: "Shell",
      content: `export MEMTRACE_SERVICE_NAME="mi-agente"
export MEMTRACE_OTLP_ENDPOINT="http://localhost:4317"
export MEMTRACE_CAPTURE_CONTENT="true"`,
    },
    example: {
      title: "example.py",
      content: `from memtrace import init_tracer, MemTraceCallbackHandler, session
from langgraph.graph import StateGraph
from langchain.tools import tool

init_tracer(service_name="mi-agente")

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
    result = graph.invoke(
        {"input": "What's the weather?"},
        config=config
    )`,
    },
  },
  "langgraph-typescript": {
    install: {
      title: "npm",
      content: "npm install memtrace-ai langchain langgraph",
    },
    env: {
      title: "Shell",
      content: `export MEMTRACE_SERVICE_NAME="mi-agente"
export MEMTRACE_OTLP_ENDPOINT="http://localhost:4317"
export MEMTRACE_CAPTURE_CONTENT="true"`,
    },
    example: {
      title: "example.ts",
      content: `import { initTracer, MemTraceCallbackHandler, session } from "memtrace-ai";
import { StateGraph } from "@langchain/langgraph";
import { tool } from "@langchain/core/tools";

initTracer({ serviceName: "mi-agente" });

const search = tool(
  async (query: string) => {
    return \`Results for: \${query}\`;
  },
  { name: "search", description: "Search for information." }
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
      title: "pip",
      content: "pip install memtrace-ai pydantic-ai",
    },
    env: {
      title: "Shell",
      content: `export MEMTRACE_SERVICE_NAME="mi-agente"
export MEMTRACE_OTLP_ENDPOINT="http://localhost:4317"
export MEMTRACE_CAPTURE_CONTENT="true"`,
    },
    example: {
      title: "example.py",
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
      title: "npm",
      content: "npm install memtrace-ai pydantic-ai",
    },
    env: {
      title: "Shell",
      content: `export MEMTRACE_SERVICE_NAME="mi-agente"
export MEMTRACE_OTLP_ENDPOINT="http://localhost:4317"
export MEMTRACE_CAPTURE_CONTENT="true"`,
    },
    example: {
      title: "example.ts",
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

const frameworks = [
  { id: "langchain" as const, label: "LangChain", icon: "🔗" },
  { id: "langgraph" as const, label: "LangGraph", icon: "📊" },
  { id: "pydantic-ai" as const, label: "PydanticAI", icon: "🤖" },
];

const languages = [
  { id: "python" as const, label: "Python", icon: "🐍" },
  { id: "typescript" as const, label: "TypeScript", icon: "📘" },
];
</script>

<template>
  <div class="guide">
    <!-- Header -->
    <div class="header">
      <div class="header-content">
        <q-icon name="schedule" size="24px" class="header-icon" />
        <div class="header-text">
          <h2>Waiting for traces...</h2>
          <p>No traces detected yet. Follow our guide to start tracing your application.</p>
        </div>
      </div>
      <a href="#" class="view-docs">View docs →</a>
    </div>

    <!-- Section 1: Select Framework -->
    <section class="guide-section">
      <h3>Trace an existing app</h3>
      <div class="frameworks-grid">
        <button
          v-for="fw in frameworks"
          :key="fw.id"
          :class="{ active: selectedFramework === fw.id }"
          class="framework-btn"
          @click="selectedFramework = fw.id"
        >
          <span class="fw-icon">{{ fw.icon }}</span>
          <span class="fw-label">{{ fw.label }}</span>
        </button>
      </div>
    </section>

    <!-- Section 2: Select Language -->
    <section class="guide-section">
      <h3>Select a language</h3>
      <div class="languages-grid">
        <button
          v-for="lang in languages"
          :key="lang.id"
          :class="{ active: selectedLanguage === lang.id }"
          class="language-btn"
          @click="selectedLanguage = lang.id"
        >
          <span class="lang-icon">{{ lang.icon }}</span>
          <span class="lang-label">{{ lang.label }}</span>
        </button>
      </div>
    </section>

    <!-- Section 3: Install Dependencies -->
    <section class="guide-section">
      <h3>Install dependencies</h3>
      <div class="code-block">
        <pre><code>{{ currentGuide.install.content }}</code></pre>
        <button
          class="copy-btn"
          :title="`Copy: ${currentGuide.install.content}`"
          @click="copyToClipboard(currentGuide.install.content)"
        >
          <q-icon name="content_copy" size="16px" />
        </button>
      </div>
    </section>

    <!-- Section 4: Configure Environment -->
    <section class="guide-section">
      <h3>Configure environment</h3>
      <div class="code-block">
        <pre><code>{{ currentGuide.env.content }}</code></pre>
        <button class="copy-btn" title="Copy" @click="copyToClipboard(currentGuide.env.content)">
          <q-icon name="content_copy" size="16px" />
        </button>
      </div>
    </section>

    <!-- Section 5: Run Quickstart -->
    <section class="guide-section">
      <h3>Run the quickstart</h3>
      <div class="code-block">
        <pre><code>{{ currentGuide.example.content }}</code></pre>
        <button class="copy-btn" title="Copy" @click="copyToClipboard(currentGuide.example.content)">
          <q-icon name="content_copy" size="16px" />
        </button>
      </div>
    </section>

    <!-- Footer Tip -->
    <div class="footer-tip">
      <strong>💡 Tip:</strong> Ensure MemTrace backend is running with <code>make up</code>
    </div>
  </div>
</template>

<style scoped>
.guide {
  max-width: 1000px;
  margin: 20px auto;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

/* Header */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  background: #f8f9fa;
  border-radius: 8px 8px 0 0;
  border-bottom: 1px solid #e5e7eb;
}

.header-content {
  display: flex;
  align-items: center;
  gap: 16px;
}

.header-icon {
  flex-shrink: 0;
  color: #3b82f6;
}

.header-text h2 {
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
}

.header-text p {
  margin: 0;
  font-size: 14px;
  color: #6b7280;
}

.view-docs {
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 500;
  color: #3b82f6;
  text-decoration: none;
  border-radius: 4px;
  transition: background 200ms;
  white-space: nowrap;
}

.view-docs:hover {
  background: rgba(59, 130, 246, 0.1);
}

/* Sections */
.guide-section {
  padding: 24px;
  border-bottom: 1px solid #e5e7eb;
}

.guide-section:last-of-type {
  border-bottom: none;
}

.guide-section h3 {
  margin: 0 0 16px;
  font-size: 14px;
  font-weight: 600;
  color: #1f2937;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Frameworks Grid */
.frameworks-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px;
}

.framework-btn,
.language-btn {
  padding: 12px 16px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  color: #1f2937;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 200ms;
}

.framework-btn:hover,
.language-btn:hover {
  border-color: #3b82f6;
  background: #f0f4ff;
}

.framework-btn.active,
.language-btn.active {
  border-color: #3b82f6;
  background: #3b82f6;
  color: #fff;
}

.fw-icon,
.lang-icon {
  font-size: 16px;
}

/* Code Block */
.code-block {
  position: relative;
  background: #1f2937;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid #374151;
}

.code-block pre {
  margin: 0;
  padding: 16px;
  overflow-x: auto;
}

.code-block code {
  font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
  font-size: 12px;
  line-height: 1.6;
  color: #d1d5db;
}

.copy-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 6px;
  border: 1px solid rgba(209, 213, 219, 0.3);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.2);
  color: #d1d5db;
  cursor: pointer;
  transition: all 200ms;
  display: flex;
  align-items: center;
  justify-content: center;
}

.copy-btn:hover {
  background: rgba(59, 130, 246, 0.2);
  border-color: #3b82f6;
  color: #3b82f6;
}

/* Languages Grid */
.languages-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
}

/* Footer Tip */
.footer-tip {
  padding: 16px 24px;
  background: #eff6ff;
  border-bottom: 1px solid #dbeafe;
  border-radius: 0 0 8px 8px;
  font-size: 13px;
  color: #1e40af;
  border-left: 4px solid #3b82f6;
}

.footer-tip code {
  background: rgba(59, 130, 246, 0.1);
  padding: 2px 6px;
  border-radius: 3px;
  font-family: monospace;
  font-size: 12px;
}

/* Responsive */
@media (max-width: 768px) {
  .guide {
    margin: 16px 0;
  }

  .header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .frameworks-grid,
  .languages-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
