<script setup lang="ts">
import { computed } from "vue";
import type { RepoConfigDto } from "@contract";
import { commitUrl } from "@/domain/assistants";
import { shortRevision } from "@/domain/format";

/** Versión del código (ADR-065): SHA corto, enlazado al commit si el agente declara su repositorio. */
const props = defineProps<{ revision: string | null; repo?: RepoConfigDto | null; dirty?: boolean | null }>();
const href = computed(() => (props.revision ? commitUrl(props.repo, props.revision) : null));
const title = computed(() =>
  props.revision ? `Code version ${props.revision}${props.dirty ? " (uncommitted changes)" : ""}` : "No code version: the agent does not send its commit (see Configuration → Code version on every trace)",
);
</script>

<template>
  <a v-if="href" :href="href" target="_blank" rel="noopener noreferrer" class="mt-pill unset mono" :title="title" data-testid="commit-link" @click.stop>{{ shortRevision(revision) }}<template v-if="dirty"> ✱</template></a>
  <span v-else class="mt-pill unset mono" :title="title" data-testid="commit-link">{{ shortRevision(revision) }}<template v-if="dirty"> ✱</template></span>
</template>
