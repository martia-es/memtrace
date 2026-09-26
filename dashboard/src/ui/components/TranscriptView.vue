<script setup lang="ts">
import type { TranscriptResponse } from "@contract";
import { formatDateTime } from "@/domain/format";

defineProps<{ transcript: TranscriptResponse }>();
defineEmits<{ open: [traceId: string] }>();
</script>

<template>
  <div>
    <q-banner v-if="!transcript.contentCaptured" rounded class="bg-blue-1 text-grey-9" role="status">
      <template #avatar><q-icon name="info" color="primary" /></template>
      Esta conversación no tiene mensajes guardados. Activa <code>MEMTRACE_CAPTURE_CONTENT=true</code> en el agente para
      verlos aquí (se guardan los prompts y respuestas tal cual: revisa la privacidad).
    </q-banner>
    <q-banner v-else-if="transcript.turns.length === 0" rounded class="bg-grey-3 text-grey-9" role="status">
      Hay contenido guardado, pero no se han encontrado mensajes de usuario ni de asistente que mostrar.
    </q-banner>

    <q-banner v-if="transcript.truncated" rounded dense class="bg-warning text-black q-mt-sm">
      La conversación es muy larga: solo se muestran los primeros 500 mensajes de LLM.
    </q-banner>

    <div v-for="(turn, i) in transcript.turns" :key="turn.traceId" class="turn q-mt-md">
      <div class="text-caption text-grey-7 q-mb-xs row items-center">
        <span>Turno {{ i + 1 }} · {{ formatDateTime(turn.startTime) }}</span>
        <q-btn flat dense no-caps size="sm" icon="timeline" label="Ver traza" class="q-ml-sm" @click="$emit('open', turn.traceId)" />
      </div>
      <div v-if="turn.user" class="bubble-row user"><div class="bubble user-bubble" data-role="user">{{ turn.user }}</div></div>
      <div v-if="turn.assistant" class="bubble-row">
        <div class="bubble assistant-bubble" data-role="assistant">
          {{ turn.assistant }}
          <div v-if="turn.model" class="text-caption text-grey-7 q-mt-xs">{{ turn.model }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bubble-row {
  display: flex;
  margin-top: 6px;
}
.bubble-row.user {
  justify-content: flex-end;
}
.bubble {
  max-width: 78%;
  padding: 8px 12px;
  border-radius: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 14px;
}
.user-bubble {
  background: var(--q-primary);
  color: #fff;
  border-bottom-right-radius: 3px;
}
.assistant-bubble {
  background: var(--wf-hover);
  border: 1px solid var(--wf-line);
  border-bottom-left-radius: 3px;
}
</style>
