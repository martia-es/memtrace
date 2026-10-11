import io
from datetime import datetime, timezone

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from model_quality.arena import MIN_ROWS, ArenaError, latest_file, parse_leaderboard


def parquet(rows: list[dict], schema: pa.Schema | None = None) -> bytes:
    table = pa.Table.from_pylist(rows, schema=schema)
    buffer = io.BytesIO()
    pq.write_table(table, buffer)
    return buffer.getvalue()


def row(i: int, **over) -> dict:
    base = {
        "model_name": f"model-{i}",
        "organization": "acme",
        "license": "Proprietary",
        "rating": 1400.5 + i,
        "rating_lower": 1397.5 + i,
        "rating_upper": 1403.5 + i,
        "variance": 3.0,
        "vote_count": 1000.0 + i,
        "rank": float(i + 1),
        "category": "overall",
        "leaderboard_publish_date": "2026-10-08",
    }
    return {**base, **over}


def board(n: int = MIN_ROWS + 5, **over) -> list[dict]:
    return [row(i, **over) for i in range(n)]


def test_reads_the_rows_of_the_category():
    rows = parse_leaderboard(parquet(board() + [row(900, category="coding", model_name="other")]))
    assert len(rows) == MIN_ROWS + 5
    first = next(r for r in rows if r.model_name == "model-0")
    assert (first.rating, first.rating_lower, first.rating_upper, first.vote_count, first.rank) == (1400.5, 1397.5, 1403.5, 1000, 1)
    assert first.published_at == datetime(2026, 10, 8, tzinfo=timezone.utc)
    assert (first.organization, first.license) == ("acme", "Proprietary")


def test_the_numbers_arrive_as_floats_and_leave_as_integers():
    rows = parse_leaderboard(parquet(board()))
    assert all(isinstance(r.vote_count, int) and isinstance(r.rank, int) for r in rows)


def test_a_dropped_column_stops_the_sync():
    data = parquet([{k: v for k, v in r.items() if k != "rating_upper"} for r in board()])
    with pytest.raises(ArenaError, match="cannot be read"):
        parse_leaderboard(data)


def test_garbage_is_not_a_leaderboard():
    with pytest.raises(ArenaError):
        parse_leaderboard(b"not a parquet file")


def test_too_few_rows_stop_the_sync():
    with pytest.raises(ArenaError, match="usable rows"):
        parse_leaderboard(parquet(board(MIN_ROWS - 1)))


def test_a_category_with_no_rows_stops_the_sync():
    with pytest.raises(ArenaError):
        parse_leaderboard(parquet(board()), category="webdev")


@pytest.mark.parametrize(
    "bad",
    [
        {"model_name": ""},
        {"model_name": None},
        {"model_name": "x" * 301},
        {"rating": float("nan")},
        {"rating": float("inf")},
        {"rating": None},
        {"vote_count": -1.0},
        {"rank": -2.0},
        {"rating_lower": 1500.0, "rating_upper": 1400.0},
        {"leaderboard_publish_date": "not a date"},
        {"leaderboard_publish_date": None},
    ],
)
def test_a_bad_row_is_dropped_not_repaired(bad):
    rows = parse_leaderboard(parquet(board() + [{**row(777, model_name="bad-model"), **bad}]))
    assert "bad-model" not in {r.model_name for r in rows}
    assert len(rows) == MIN_ROWS + 5


def test_long_text_is_trimmed():
    rows = parse_leaderboard(parquet([row(i, organization="o" * 500, license="l" * 500) for i in range(MIN_ROWS)]))
    assert len(rows[0].organization) == 120 and len(rows[0].license) == 120


def test_the_same_model_twice_keeps_the_one_with_more_votes():
    rows = parse_leaderboard(parquet(board() + [row(1, model_name="model-0", vote_count=50000.0, rating=1500.0, rating_lower=1495.0, rating_upper=1505.0)]))
    assert [r.rating for r in rows if r.model_name == "model-0"] == [1500.0]


def test_dates_as_real_dates_also_work():
    schema = pa.schema(
        [("model_name", pa.string()), ("organization", pa.string()), ("license", pa.string()), ("rating", pa.float64()), ("rating_lower", pa.float64()),
         ("rating_upper", pa.float64()), ("vote_count", pa.float64()), ("rank", pa.float64()), ("category", pa.string()), ("leaderboard_publish_date", pa.date32())]
    )
    from datetime import date

    rows = parse_leaderboard(parquet([{k: v for k, v in row(i).items() if k != "variance"} | {"leaderboard_publish_date": date(2026, 10, 8)} for i in range(MIN_ROWS)], schema))
    assert rows[0].published_at == datetime(2026, 10, 8, tzinfo=timezone.utc)


TREE = [
    {"type": "directory", "path": "text/sub"},
    {"type": "file", "path": "text/full-00000-of-00001.parquet", "size": 58860767},
    {"type": "file", "path": "text/latest-00000-of-00001.parquet", "size": 608228},
    {"type": "file", "path": "text_style_control/latest-00000-of-00001.parquet", "size": 1},
]


def test_finds_the_latest_file_of_the_board_only():
    assert latest_file(TREE, "text") == "text/latest-00000-of-00001.parquet"


def test_refuses_when_the_file_is_missing_or_ambiguous():
    with pytest.raises(ArenaError):
        latest_file([e for e in TREE if "latest" not in e["path"]], "text")
    with pytest.raises(ArenaError):
        latest_file(TREE + [{"type": "file", "path": "text/latest-00001-of-00002.parquet", "size": 1}], "text")


def test_refuses_an_oversized_file():
    with pytest.raises(ArenaError, match="more than"):
        latest_file([{"type": "file", "path": "text/latest-00000-of-00001.parquet", "size": 10**9}], "text")
