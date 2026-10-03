-- Identidad del juez detrás de un score `llm_judge` (ADR-043): qué modelo juzgó y con qué rúbrica.
-- JudgePromptHash es la huella de la plantilla (system prompt + esqueleto del prompt), no del prompt
-- de cada item, así que solo cambia cuando cambia el juez. NULL para scores de otro origen y para
-- los anteriores a esta migración (no se pueden reconstruir). No toca el ORDER BY: un run tiene un
-- único juez por (item, Name), y reenviar un lote sigue siendo idempotente (ADR-034).
ALTER TABLE memtrace.scores ADD COLUMN IF NOT EXISTS JudgeModel Nullable(String) CODEC(ZSTD(1));
ALTER TABLE memtrace.scores ADD COLUMN IF NOT EXISTS JudgePromptHash Nullable(String) CODEC(ZSTD(1));
