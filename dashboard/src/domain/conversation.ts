import type { TraceSummaryDto } from "@contract";

export interface Turn {
  trace: TraceSummaryDto;
  /** 1-based, en orden cronológico */
  index: number;
  /** ms entre el fin del turno anterior y el inicio de este; null en el primero; negativo = se solapan */
  gapMs: number | null;
}

/** Numera los turnos (ya en orden cronológico) y calcula la espera entre uno y el siguiente. */
export function withGaps(turns: TraceSummaryDto[]): Turn[] {
  return turns.map((trace, i) => {
    const prev = turns[i - 1];
    const gapMs = prev ? Date.parse(trace.startTime) - (Date.parse(prev.startTime) + prev.durationMs) : null;
    return { trace, index: i + 1, gapMs };
  });
}
