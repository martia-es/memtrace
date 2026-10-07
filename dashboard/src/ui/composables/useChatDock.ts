import { reactive } from "vue";
import type { ChatMessage } from "@/domain/chat-dock";
import { fullscreenPath } from "@/domain/assistant-display";
import { modeFor } from "./useAssistantDisplay";

/** Estado del panel de chat. Es de módulo para que la conversación sobreviva a la navegación entre pantallas. */
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

/** Relevo a la pestaña de pantalla completa: localStorage sí llega a la pestaña nueva y se borra al leerlo. */
const HANDOFF_KEY = "memtrace:assistantHandoff";

function show(target: ChatTarget) {
  const same = state.target?.experimentId === target.experimentId && state.target.deploymentId === target.deploymentId;
  if (!same) {
    state.messages = [];
    state.sessionId = null;
  }
  state.target = target;
  state.minimized = false;
}

function close() {
  state.target = null;
  state.maximized = false;
  state.messages = [];
  state.sessionId = null;
}

/** Abre la pestaña de pantalla completa llevándose la conversación en curso si es de este mismo agente y entorno. */
function openFullscreen(target: ChatTarget) {
  const same = state.target?.experimentId === target.experimentId && state.target.deploymentId === target.deploymentId;
  try {
    if (same) localStorage.setItem(HANDOFF_KEY, JSON.stringify({ target, sessionId: state.sessionId, messages: state.messages }));
    else localStorage.removeItem(HANDOFF_KEY);
  } catch {
    // sin almacenamiento la pestaña empieza una conversación nueva
  }
  window.open(fullscreenPath(target), "_blank");
  if (same) close();
}

export function useChatDock() {
  return {
    state,
    /** Abre el chat según el modo que toque (ADR-063): burbuja y panel lateral viven en esta pantalla; pantalla completa, en otra pestaña. */
    open(target: ChatTarget) {
      if (modeFor(target.experimentId) === "fullscreen") openFullscreen(target);
      else show(target);
    },
    /** Abre el chat en esta pantalla sin consultar el modo: lo usa la pestaña de pantalla completa. */
    show,
    openFullscreen,
    /** Recoge (y borra) la conversación que dejó la pestaña de origen, si es de este agente y entorno. */
    takeHandoff(target: ChatTarget) {
      try {
        const raw = localStorage.getItem(HANDOFF_KEY);
        localStorage.removeItem(HANDOFF_KEY);
        if (!raw) return;
        const handoff = JSON.parse(raw) as { target?: ChatTarget; sessionId?: string | null; messages?: ChatMessage[] };
        if (handoff.target?.experimentId !== target.experimentId || handoff.target.deploymentId !== target.deploymentId) return;
        state.messages = Array.isArray(handoff.messages) ? handoff.messages : [];
        state.sessionId = handoff.sessionId ?? null;
      } catch {
        // relevo ilegible: se empieza de cero
      }
    },
    close,
    reset() {
      state.messages = [];
      state.sessionId = null;
    },
  };
}
