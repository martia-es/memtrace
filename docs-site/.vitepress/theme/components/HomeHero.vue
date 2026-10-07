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

// The logo is a trace waterfall; the background draws a bigger one.
const bars = [
  { l: 2, w: 26, c: "t" }, { l: 9, w: 34, c: "h" }, { l: 17, w: 18, c: "t" }, { l: 22, w: 30, c: "t" },
  { l: 31, w: 22, c: "h" }, { l: 36, w: 40, c: "t" }, { l: 47, w: 16, c: "t" }, { l: 52, w: 28, c: "h" },
  { l: 60, w: 34, c: "t" }, { l: 66, w: 20, c: "t" }, { l: 72, w: 26, c: "h" }, { l: 78, w: 18, c: "t" },
];
</script>

<template>
  <section class="mt-hero">
    <div class="mt-hero-bg" aria-hidden="true">
      <i v-for="(b, i) in bars" :key="i" :class="b.c" :style="{ left: b.l + '%', width: b.w + '%', top: 6 + i * 7.5 + '%', animationDelay: i * 0.18 + 's' }" />
    </div>

    <div class="mt-hero-inner">
      <span class="mt-eyebrow"><b /> Open source · OpenTelemetry-native</span>
      <h1>See what your AI agents <em>really do</em>.</h1>
      <p class="mt-lead">
        Trace every LLM call and tool, review conversations with your team, and turn what you learn into tests.
        Observability, evaluation and governance for AI assistants, in one calm place.
      </p>
      <div class="mt-actions">
        <a class="mt-btn primary" :href="withBase('/library/quickstart')">Instrument your agent</a>
        <a class="mt-btn" :href="withBase('/platform/getting-started')">Run the platform</a>
        <button class="mt-install" type="button" :aria-label="`Copy ${install}`" @click="copy">
          <span>$</span><code>{{ install }}</code><small>{{ copied ? "Copied" : "Copy" }}</small>
        </button>
      </div>
    </div>

    <div class="mt-shot-wrap">
      <div class="mt-chip c1" aria-hidden="true"><i class="bad" />6 executions ended with errors</div>
      <div class="mt-chip c2" aria-hidden="true"><i class="ok" />3 traces rated low by reviewers</div>
      <div class="mt-shot">
        <div class="mt-shot-bar" aria-hidden="true"><i /><i /><i /></div>
        <img
          :src="withBase('/screenshots/overview.png')"
          alt="The MemTrace Overview: health of the assistant, key figures and what needs attention"
          width="1916"
          height="680"
        />
      </div>
    </div>
  </section>
</template>
