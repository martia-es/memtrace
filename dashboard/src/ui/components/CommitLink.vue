<script setup lang="ts">
import { computed } from "vue";
import type { RepoConfigDto } from "@contract";
import { commitUrl } from "@/domain/assistants";
import { shortRevision } from "@/domain/format";
import Pill from "./Pill.vue";

/** Versión del código (ADR-065): SHA corto, enlazado al commit si el agente declara su repositorio. */
const props = defineProps<{ revision: string | null; repo?: RepoConfigDto | null; dirty?: boolean | null }>();
const href = computed(() => (props.revision ? commitUrl(props.repo, props.revision) : null));
const title = computed(() =>
  props.revision ? `Code version ${props.revision}${props.dirty ? " (uncommitted changes)" : ""}` : "No code version: the agent does not send its commit (see Configuration → Code version on every trace)",
);
</script>

<template>
  <a v-if="href" :href="href" target="_blank" rel="noopener noreferrer" class="commit-link" :title="title" data-testid="commit-link" @click.stop><Pill mono>{{ shortRevision(revision) }}<template v-if="dirty"> ✱</template></Pill></a>
  <Pill mono v-else :title="title" data-testid="commit-link">{{ shortRevision(revision) }}<template v-if="dirty"> ✱</template></Pill>
</template>

<style scoped>
.commit-link {
  text-decoration: none;
}
</style>
