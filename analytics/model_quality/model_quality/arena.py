"""Lectura del leaderboard de Arena (ADR-025, ampliación).

Arena publica el historial de sus leaderboards como dataset público en Hugging Face (licencia CC BY 4.0). Este módulo no
sabe nada de ClickHouse: descarga el parquet `latest` de un tablero, lo valida y devuelve filas limpias. Es dato de un tercero:
se lee solo con `pyarrow` (nada de `datasets` ni de pickle), se acotan los tamaños y una fila rara se descarta, no se arregla.
"""

from __future__ import annotations

import io
import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx
import pyarrow.parquet as pq

HF = "https://huggingface.co"
MAX_PARQUET_BYTES = 50 * 1024 * 1024
MAX_NAME_CHARS = 300
MAX_TEXT_CHARS = 120
# Un leaderboard completo tiene cientos de modelos. Con muy pocas filas el fichero está truncado o ha cambiado de forma:
# mejor no sincronizar que sustituir lo que había por casi nada.
MIN_ROWS = 50

REQUIRED_COLUMNS = (
    "model_name",
    "organization",
    "license",
    "rating",
    "rating_lower",
    "rating_upper",
    "vote_count",
    "rank",
    "category",
    "leaderboard_publish_date",
)


class ArenaError(Exception):
    """El leaderboard no se pudo leer o no tiene la forma esperada. El job falla y ClickHouse queda como estaba."""


@dataclass
class ArenaRow:
    model_name: str
    organization: str
    license: str
    rating: float
    rating_lower: float
    rating_upper: float
    vote_count: int
    rank: int
    published_at: datetime


def latest_file(tree: list[dict], board: str) -> str:
    """El fichero `<board>/latest-…parquet` del listado del repositorio."""
    pattern = re.compile(rf"^{re.escape(board)}/latest-\d+-of-\d+\.parquet$")
    found = [e for e in tree if isinstance(e, dict) and e.get("type") == "file" and pattern.match(str(e.get("path", "")))]
    if len(found) != 1:
        raise ArenaError(f"Expected one latest parquet for '{board}', found {len(found)}")
    size = found[0].get("size")
    if isinstance(size, int) and size > MAX_PARQUET_BYTES:
        raise ArenaError(f"The leaderboard file is {size} bytes, more than the {MAX_PARQUET_BYTES} allowed")
    return str(found[0]["path"])


def _published_at(value: object) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value[:10]).replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    if hasattr(value, "year") and hasattr(value, "month") and hasattr(value, "day"):  # datetime.date
        return datetime(value.year, value.month, value.day, tzinfo=timezone.utc)  # type: ignore[attr-defined]
    return None


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) else None


def parse_leaderboard(data: bytes, category: str = "overall") -> list[ArenaRow]:
    """Valida el parquet y devuelve las filas de la categoría. Falla si la forma no es la esperada o si quedan muy pocas filas."""
    if len(data) > MAX_PARQUET_BYTES:
        raise ArenaError("The leaderboard file is too large")
    try:
        table = pq.read_table(io.BytesIO(data), columns=list(REQUIRED_COLUMNS))
    except Exception as error:  # pyarrow lanza varios tipos según qué falte o esté corrupto
        raise ArenaError(f"The leaderboard file cannot be read: {error}") from error

    rows: list[ArenaRow] = []
    skipped = 0
    for record in table.to_pylist():
        if record.get("category") != category:
            continue
        name = record.get("model_name")
        rating, lower, upper = _number(record.get("rating")), _number(record.get("rating_lower")), _number(record.get("rating_upper"))
        votes, rank = _number(record.get("vote_count")), _number(record.get("rank"))
        published = _published_at(record.get("leaderboard_publish_date"))
        if (
            not isinstance(name, str)
            or not name.strip()
            or len(name) > MAX_NAME_CHARS
            or None in (rating, lower, upper, votes, rank)
            or published is None
            or votes < 0  # type: ignore[operator]
            or rank < 0  # type: ignore[operator]
            or lower > upper  # type: ignore[operator]
        ):
            skipped += 1
            continue
        rows.append(
            ArenaRow(
                model_name=name.strip(),
                organization=str(record.get("organization") or "")[:MAX_TEXT_CHARS],
                license=str(record.get("license") or "")[:MAX_TEXT_CHARS],
                rating=rating,  # type: ignore[arg-type]
                rating_lower=lower,  # type: ignore[arg-type]
                rating_upper=upper,  # type: ignore[arg-type]
                vote_count=int(votes),  # type: ignore[arg-type]
                rank=int(rank),  # type: ignore[arg-type]
                published_at=published,
            )
        )
    if len(rows) < MIN_ROWS:
        raise ArenaError(f"Only {len(rows)} usable rows for '{category}' ({skipped} skipped); expected at least {MIN_ROWS}")
    # el mismo modelo dos veces en un leaderboard no debería pasar; si pasa, vale la fila con más votos
    best: dict[str, ArenaRow] = {}
    for row in rows:
        if row.model_name not in best or row.vote_count > best[row.model_name].vote_count:
            best[row.model_name] = row
    return list(best.values())


def fetch_latest(client: httpx.Client, dataset: str, board: str, category: str) -> list[ArenaRow]:
    """Descarga el último leaderboard de un tablero (p. ej. `text`) y devuelve sus filas validadas."""
    tree = client.get(f"{HF}/api/datasets/{dataset}/tree/main/{board}")
    tree.raise_for_status()
    path = latest_file(tree.json(), board)
    response = client.get(f"{HF}/datasets/{dataset}/resolve/main/{path}", follow_redirects=True)
    response.raise_for_status()
    return parse_leaderboard(response.content, category)
