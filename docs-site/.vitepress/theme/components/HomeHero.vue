<script setup lang="ts">
import { ref } from "vue";
import { withBase } from "vitepress";

const copied = ref(false);
const install = "pip install memtrace-ai";

async function copy() {
  try {
    await navigator.clipboard.writeText(install);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1800);
  } catch {
    /* clipboard not available: the command is selectable anyway */
  }
}

// Daily cost bars of the "Read" tile; the highlighted one is the spike that fires a budget alert.
const bars = [34, 46, 40, 62, 88, 58, 50];
</script>

<template>
  <div class="mt-home">
    <section class="mt-hero">
      <h1>See what your<br />agents <em>really do.</em></h1>
      <div class="mt-hero-row">
        <p class="mt-lead">
          Observability, evaluation and governance for AI assistants. Open source, OpenTelemetry-native, self-hosted.
        </p>
        <div class="mt-actions">
          <a class="mt-btn primary" :href="withBase('/library/quickstart')">Instrument your agent</a>
          <a class="mt-btn" :href="withBase('/platform/getting-started')">Run the platform</a>
          <button class="mt-install" type="button" :aria-label="`Copy ${install}`" @click="copy">
            <span>$</span><code>{{ install }}</code><small>{{ copied ? "Copied" : "Copy" }}</small>
          </button>
        </div>
      </div>
    </section>

    <section class="mt-bento" aria-label="What MemTrace does">
      <div class="mt-grid3">
        <a class="mt-tile" :href="withBase('/library/quickstart')">
          <span class="mt-kicker">Trace</span>
          <strong>Three lines, every call.</strong>
          <pre class="mt-code"><span class="k">from</span> memtrace <span class="k">import</span> init_tracer, trace_step

init_tracer(service_name=<span class="s">"my-agent"</span>)

<span class="c">@trace_step(name="search", step_type="tool")</span>
<span class="k">def</span> search(query): ...</pre>
        </a>

        <a class="mt-tile" :href="withBase('/platform/dashboard')">
          <span class="mt-kicker">Dashboard</span>
          <strong>Cost and latency, by assistant.</strong>
          <div class="mt-bars" aria-hidden="true">
            <i v-for="(h, i) in bars" :key="i" :class="{ hot: h === 88 }" :style="{ height: h + '%', animationDelay: i * 0.05 + 's' }" />
          </div>
          <p class="mt-foot"><b>Spike</b> · budget alert sent by email and in-app</p>
        </a>

        <a class="mt-tile light" :href="withBase('/platform/annotations')">
          <span class="mt-kicker">Review</span>
          <strong>Two profiles, one inbox.</strong>
          <div class="mt-rows">
            <div><span>“Is it safe to run today?”</span><b class="bad">2 / 5</b></div>
            <div><span>“Cancel my order”</span><b class="ok">5 / 5</b></div>
          </div>
          <div class="mt-pills">
            <span>Business · rate</span><span class="dark">Technical · promote to dataset</span>
          </div>
        </a>
      </div>

      <a class="mt-tile mt-read" :href="withBase('/platform/dashboard')">
        <div class="mt-read-head">
          <div>
            <span class="mt-kicker">Read</span>
            <strong>Conversations, not JSON.</strong>
          </div>
          <p>The same trace, read by a person: what was asked, what failed, what was answered and where the time went.</p>
        </div>
        <div class="mt-read-body">
          <div class="mt-raw">
            <span class="mt-label bad">Raw spans</span>
            <pre aria-hidden="true">{"name":"chat gemini-2.5-flash","kind":3,
 "attributes":[
  {"key":"gen_ai.request.model","value":{"stringValue":"gemini-2.5-flash"}},
  {"key":"gen_ai.usage.input_tokens","value":{"intValue":"1843"}},
  {"key":"gen_ai.prompt.0.role","value":{"stringValue":"user"}},
  {"key":"gen_ai.prompt.0.content","value":{"stringValue":"Is it safe…"}}],
 "events":[{"name":"gen_ai.choice","attributes":[…]}],
 "status":{"code":1}}
{"name":"execute_tool get_air_quality","kind":1,
 "attributes":[
  {"key":"gen_ai.tool.name","value":{"stringValue":"get_air_quality"}},
  {"key":"error.type","value":{"stringValue":"TimeoutError"}}],
 "status":{"code":2,"message":"timeout after 10s"}}
{"name":"chat gemini-2.5-flash","kind":3,
 "attributes":[
  {"key":"gen_ai.usage.output_tokens","value":{"intValue":"212"}},
  {"key":"gen_ai.completion.0.content","value":{"stringValue":"Air…</pre>
          </div>
          <div class="mt-chat">
            <span class="mt-label ok">With MemTrace</span>
            <div class="mt-msg user">Is it safe to run in Madrid today?</div>
            <div class="mt-toolerr"><code>get_air_quality</code><b>failed · timeout after 10s</b><small>2 retries</small></div>
            <div class="mt-msg bot">Air quality data isn’t available right now. The weather looks fine, light wind and mild temperatures, so a short run should be OK.</div>
            <div class="mt-timeline">
              <small>Where this turn spent its time</small>
              <div><i style="flex: 20" /><i style="flex: 14" class="b" /><i style="flex: 30" class="hot" /><i style="flex: 30" /><i style="flex: 6" class="k" /></div>
              <p><span>plan</span><span>weather</span><span class="bad">air quality (failed)</span><span>answer</span></p>
            </div>
          </div>
        </div>
      </a>

      <div class="mt-row2">
        <a class="mt-tile mt-eval" :href="withBase('/platform/evaluation')">
          <div>
            <span class="mt-kicker">Evaluate</span>
            <strong>Know before you ship.</strong>
            <p>Run a dataset against a new prompt and compare it with the last run, evaluator by evaluator.</p>
          </div>
          <div class="mt-compare" aria-hidden="true">
            <div><span>v1</span><i><u style="width: 62%" /></i><b>62%</b></div>
            <div><span>v2</span><i><u class="up" style="width: 81%" /></i><b class="up">81%</b></div>
            <small>Illustrative numbers</small>
          </div>
        </a>

        <a class="mt-tile hot" :href="withBase('/platform/assistants')">
          <span class="mt-kicker">Govern</span>
          <strong>A catalog of every assistant.</strong>
          <div class="mt-pills">
            <span class="dark">production</span><span>staging</span><span>MCP · tools</span><span>roles</span>
          </div>
        </a>
      </div>
    </section>
  </div>
</template>
