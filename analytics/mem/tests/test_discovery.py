import random

import numpy as np
import pandas as pd

from mem.discovery import Config, cluster_goals, discover, mask_goal

CITIES = ["Rome", "Berlin", "Madrid", "Lisbon", "Paris", "Porto"]


def episode(i, *, kind="ok", version="1", lang="en"):
    """Un episodio sintético. `kind` decide qué le pasa; el resto de campos es el de un episodio normal."""
    a, b = random.Random(i).sample(CITIES, 2)
    base = dict(trace_id=f"t{i}", kind=kind, outcome="ok", has_error=False, decisive_step="", decisive_error="", steps="chat>geocode>get_forecast>chat",
                tools="geocode>get_forecast", empty_arg_tools="", prompt_version=version,
                attrs={"user.lang": lang, "gen_ai.request.model": "m1", "prompt.version": version}, goal=f"What is the weather in {a} today?")
    if kind == "empty_city":
        base.update(outcome="failed", has_error=True, decisive_step="get_forecast", decisive_error="city must not be empty",
                    steps="chat>get_forecast", tools="get_forecast", empty_arg_tools="get_forecast", goal="Will it rain?")
    elif kind == "compare_one_call":  # fallo silencioso: pide dos ciudades y se consulta una
        base.update(outcome="failed", steps="chat>geocode>get_forecast>chat", goal=f"Is it warmer in {a} or in {b}?")
    elif kind == "compare_ok":
        base.update(steps="chat>geocode>get_forecast>geocode>get_forecast>chat", tools="geocode>get_forecast>geocode>get_forecast",
                    goal=f"Is it warmer in {a} or in {b}?")
    elif kind == "noise":
        base.update(outcome="failed", has_error=True, decisive_step="get_forecast", decisive_error="Connection reset by peer N")
    return base


def frame(n=1200, seed=0, empty_rate=0.12, compare_rate=0.15, compare_fail=0.6, noise=0.02):
    rnd = random.Random(seed)
    rows = []
    for i in range(n):
        r = rnd.random()
        version = rnd.choice(["1", "2"])
        if r < empty_rate:
            kind = "empty_city" if version == "1" else "ok"  # el prompt v2 corrige este fallo
        elif r < empty_rate + compare_rate:
            kind = "compare_one_call" if rnd.random() < compare_fail else "compare_ok"
        elif r < empty_rate + compare_rate + noise:
            kind = "noise"
        else:
            kind = "ok"
        rows.append(episode(i, kind=kind, version=version))
    return pd.DataFrame(rows)


def best_match(result, df, kind):
    """(recall, pureza) del hallazgo que mejor describe los episodios sembrados con ese fallo."""
    ids = set(df[df.kind == kind].trace_id)
    scores = [(len(ids & set(f.members)) / len(ids), len(ids & set(f.members)) / len(f.members)) for f in result.findings]
    return max(scores, key=lambda s: s[0] * s[1], default=(0.0, 0.0))


def test_finds_the_seeded_failures_with_high_recall_and_purity():
    df = frame()
    result = discover(df)
    empty_recall, empty_purity = best_match(result, df, "empty_city")
    # el fallo silencioso solo se marca `failed` en parte de los casos (60 %): lo normal es que la regla abarque también los `ok`
    compare_recall, compare_purity = best_match(result, df, "compare_one_call")
    assert empty_recall >= 0.9 and empty_purity >= 0.9, result.findings
    assert compare_recall >= 0.9 and compare_purity >= 0.4, [f.rule for f in result.findings]


def test_noise_does_not_become_a_finding():
    result = discover(frame())
    assert not any("Connection reset" in f.cause for f in result.findings)
    assert all(f.p_value < 0.01 and f.support >= Config().min_support and f.lift >= Config().min_lift for f in result.findings)


def test_failed_episodes_are_accounted_for():
    df = frame()
    result = discover(df)
    assert result.episodes == len(df) and result.failed == int((df.outcome == "failed").sum())
    assert 0 <= result.unexplained <= result.failed


def test_a_fixed_failure_shows_lower_occurrence_in_the_newer_prompt_version():
    result = discover(frame())
    fixed = next(f for f in result.findings if "must not be empty" in f.cause)
    assert fixed.occurrence_by_prompt["2"] < fixed.occurrence_by_prompt["1"] / 2


def test_too_few_episodes_means_no_findings():
    result = discover(frame(n=120))
    assert result.findings == [] and result.episodes == 120


def test_finding_ids_are_stable_between_runs_and_distinct_between_findings():
    a, b = discover(frame()), discover(frame())
    assert [f.finding_id for f in a.findings] == [f.finding_id for f in b.findings]
    assert len({f.finding_id for f in a.findings}) == len(a.findings)


def test_member_traces_include_every_example_trace():
    for f in discover(frame()).findings:
        assert set(f.example_trace_ids) <= set(f.members)


def test_mask_goal_hides_entities_but_not_the_intent():
    assert mask_goal("Is it warmer in Rome or in Bilbao?") == mask_goal("Is it warmer in Paris or in Lyon?")
    assert mask_goal("Compara la temperatura de Paris y Turin") == mask_goal("Compara la temperatura de Roma y Lyon")
    assert mask_goal("Forecast for 3 days") == "Forecast for <n> days"


def fake_embedder(texts):
    """Dos «significados» separados: lo que habla de comparar y todo lo demás."""
    return np.array([[1.0, 0.0] if ("warmer" in t or "Compara" in t) else [0.0, 1.0] for t in texts]) + np.random.default_rng(0).normal(0, 0.01, (len(texts), 2))


def test_cluster_goals_groups_by_meaning_with_an_injected_embedder():
    goals = pd.Series(["Is it warmer in Rome or in Bilbao?", "Is it warmer in Paris or in Lyon?", "What is the weather in Rome today?",
                       "What is the weather in Lyon today?", "Will it rain in Porto tomorrow?", "Is it sunny in Madrid now?"] * 3)
    labels, k, _ = cluster_goals(goals, fake_embedder, kmin=2, kmax=3)
    assert k >= 2 and labels[0] == labels[1] and labels[0] != labels[2]


def test_cluster_goals_skips_grouping_when_there_is_nothing_to_group():
    labels, k, _ = cluster_goals(pd.Series(["Is it warmer in Rome or in Bilbao?"] * 5), fake_embedder)
    assert k == 0 and set(labels) == {0}
