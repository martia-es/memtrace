-- Puntuaciones de calidad por modelo (ADR-025, ampliación). Las rellena el worker `analytics/model_quality` desde el
-- leaderboard público de Arena; la API solo las lee. Como `model_pricing`, es un catálogo de referencia público: no lleva
-- tenant y no tiene TTL. Se conserva solo la última fila de cada entrada (ReplacingMergeTree por UpdatedAt); una entrada
-- que Arena retira deja de actualizarse y se ve como «ya no está en el ranking» porque su PublishedAt queda atrás.
CREATE TABLE IF NOT EXISTS memtrace.model_quality
(
    Source LowCardinality(String) CODEC(ZSTD(1)),
    Arena LowCardinality(String) CODEC(ZSTD(1)),
    ModelName String CODEC(ZSTD(1)),
    Organization LowCardinality(String) CODEC(ZSTD(1)),
    License LowCardinality(String) CODEC(ZSTD(1)),
    Rating Float64 CODEC(ZSTD(1)),
    RatingLower Float64 CODEC(ZSTD(1)),
    RatingUpper Float64 CODEC(ZSTD(1)),
    VoteCount UInt64 CODEC(ZSTD(1)),
    Rank UInt32 CODEC(ZSTD(1)),
    PublishedAt DateTime64(3) CODEC(Delta, ZSTD(1)),
    UpdatedAt DateTime64(3) CODEC(Delta, ZSTD(1))
)
ENGINE = ReplacingMergeTree(UpdatedAt)
ORDER BY (Source, Arena, ModelName)
SETTINGS index_granularity = 8192;
