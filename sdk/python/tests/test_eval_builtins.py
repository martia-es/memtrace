from memtrace.eval import contains, exact_match


def test_exact_match_true_when_equal():
    score = exact_match(output="4", expected_output="4")
    assert score.value is True and score.name == "exact_match"


def test_exact_match_false_when_different():
    score = exact_match(output="5", expected_output="4")
    assert score.value is False


def test_exact_match_without_expected_output_is_false_with_a_comment():
    score = exact_match(output="anything", expected_output=None)
    assert score.value is False
    assert score.comment


def test_contains_true_when_substring_present():
    score = contains(output="The answer is 4.", expected_output="4")
    assert score.value is True and score.name == "contains"


def test_contains_false_when_absent():
    score = contains(output="no clue", expected_output="4")
    assert score.value is False
