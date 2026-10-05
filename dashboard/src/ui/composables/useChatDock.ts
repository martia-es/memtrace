import { reactive } from "vue";
import type { ChatMessage } from "@/domain/chat-dock";

/** Estado del panel de chat flotante. Es de módulo para que la conversación sobreviva a la navegación entre pantallas. */
export interface ChatTarget {
  experimentId: string;
  deploymentId: string;
  agentName: string;
  environmentLabel: string;
}

interface DockState {
  target: ChatTarget | null;
  minimized: boolean;
  maximized: boolean;
  messages: ChatMessage[];
  sessionId: string | null;
}

const state = reactive<DockState>({ target: null, minimized: false, maximized: false, messages: [], sessionId: null });

export function useChatDock() {
  return {
    state,
    /** Abre el panel; si ya había otra conversación con otro agente o entorno, empieza una nueva. */
    open(target: ChatTarget) {
      const same = state.target?.experimentId === target.experimentId && state.target.deploymentId === target.deploymentId;
      if (!same) {
        state.messages = [];
        state.sessionId = null;
      }
      state.target = target;
      state.minimized = false;
    },
    close() {
      state.target = null;
      state.maximized = false;
      state.messages = [];
      state.sessionId = null;
    },
    reset() {
      state.messages = [];
      state.sessionId = null;
    },
  };
}
