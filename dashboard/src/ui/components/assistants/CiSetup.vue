<script setup lang="ts">
import { computed, ref } from "vue";
import type { RepoConfigDto } from "@contract";
import { CI_LABEL, DOCKERFILE_SNIPPET, buildCommand, type CiProvider } from "@/domain/ci-snippet";
import SegmentedControl from "../SegmentedControl.vue";
import Button from "../Button.vue";

/** Cómo hacer que las trazas lleven el commit (ADR-065): dos líneas, una sola vez por repositorio. */
const props = defineProps<{ repo: RepoConfigDto | null }>();
const picked = ref<CiProvider | null>(null);
const provider = computed<CiProvider>(() => picked.value ?? props.repo?.provider ?? "github");
const providers = Object.keys(CI_LABEL) as CiProvider[];
const copied = ref<string | null>(null);

async function copy(label: string, text: string) {
  try {
    await navigator.clipboard?.writeText(text);
    copied.value = label;
    setTimeout(() => (copied.value = null), 1500);
  } catch {
    /* sin portapapeles: el texto sigue visible y seleccionable */
  }
}
</script>

<template>
  <details class="ci" data-testid="ci-setup">
    <summary>Show the code version on every trace</summary>
    <p class="hint">
      Pass the commit being built to your image, once. The CI fills it in on every build, so each trace carries the version of the code that produced it.
      Platforms that already expose the commit (Vercel, Render, Heroku) need nothing.
    </p>
    <SegmentedControl class="providers" size="sm" aria-label="CI provider" :options="providers.map((p) => ({ value: p, label: CI_LABEL[p] }))" :model-value="provider" @update:model-value="picked = $event as typeof provider" />
    <div class="block">
      <div class="block-head"><span>Dockerfile</span><Button size="sm" @click="copy('dockerfile', DOCKERFILE_SNIPPET)">{{ copied === "dockerfile" ? "Copied" : "Copy" }}</Button></div>
      <pre data-testid="ci-dockerfile">{{ DOCKERFILE_SNIPPET }}</pre>
    </div>
    <div class="block">
      <div class="block-head"><span>{{ CI_LABEL[provider] }}: build step</span><Button size="sm" @click="copy('build', buildCommand(provider))">{{ copied === "build" ? "Copied" : "Copy" }}</Button></div>
      <pre data-testid="ci-build">{{ buildCommand(provider) }}</pre>
    </div>
  </details>
</template>

<style scoped>
.ci { padding: 12px 18px; background: var(--mt-card); border: 1px solid var(--mt-line); border-radius: var(--mt-radius); }
summary { cursor: pointer; font-size: 13px; font-weight: 700; color: var(--mt-accent-text); }
.hint { margin: 10px 0; font-size: 13px; color: var(--mt-muted); max-width: 72ch; line-height: 1.5; }
.providers { margin-bottom: 10px; }

.block { margin-top: 8px; }
.block-head { display: flex; align-items: center; justify-content: space-between; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--mt-muted); }
pre { margin: 4px 0 0; padding: 10px 12px; overflow-x: auto; font-family: var(--mt-mono); font-size: 12px; background: var(--mt-bg); border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); }
</style>
