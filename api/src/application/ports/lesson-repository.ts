import type {
  EvidenceKind,
  Lesson,
  LessonActivation,
  LessonEvent,
  LessonEvidence,
  LessonStatus,
  LessonSummary,
  LessonVersion,
  NewLesson,
  NewLessonVersion,
} from "@/domain/lesson";
import type { LessonContent } from "@/domain/lesson";

export interface LessonDetail {
  summary: LessonSummary;
  versions: LessonVersion[];
  evidence: LessonEvidence[];
  activations: LessonActivation[];
  events: LessonEvent[];
}

export interface NewEvidence {
  traceId: string;
  kind: EvidenceKind;
}

/**
 * Almacén de las lecciones de Mem (ADR-104). Es la fuente de verdad curada: Postgres. Cada método que cambia estado es una
 * transacción que deja su evento. La regla «solo lo aprobado y activado llega al agente» se mantiene aquí: salir de
 * `approved` o cambiar el texto quita las activaciones.
 */
export interface LessonRepository {
  list(experimentId: string, status?: LessonStatus): Promise<LessonSummary[]>;
  get(experimentId: string, lessonId: string): Promise<LessonDetail | null>;
  /** Crea la lección con su versión 1, su evidencia y el evento `created`. Lanza `LessonInvariantError` si la huella ya existe en el experimento. */
  create(lesson: NewLesson, version: LessonContent & { contentHash: string; message: string }, evidence: NewEvidence[]): Promise<LessonSummary>;
  /** Nueva versión del texto. Vuelve la lección a `proposed` (si no lo estaba) y quita sus activaciones. `null` si no existe. */
  addVersion(experimentId: string, lessonId: string, version: NewLessonVersion): Promise<LessonSummary | null>;
  /** Pasa de `from` a `to` solo si sigue en `from` (si no, `LessonInvariantError`). Quita las activaciones al salir de `approved`. `null` si no existe. */
  transition(experimentId: string, lessonId: string, from: LessonStatus, to: LessonStatus, actor: { id: string | null; label: string }, comment: string): Promise<Lesson | null>;
  /** Activa la versión actual en un entorno. Exige `approved` (si no, `LessonInvariantError`). `null` si no existe. */
  activate(experimentId: string, lessonId: string, environment: string, actor: { id: string | null; label: string }): Promise<LessonActivation | null>;
  /** Quita la activación. `false` si no estaba activa. */
  deactivate(experimentId: string, lessonId: string, environment: string, actor: { id: string | null; label: string }): Promise<boolean>;
}
