from db.repository import summarize_price_history


def test_history_summary_requires_ten_samples_before_giving_price_judgement():
    rows = [{"lowest_price_twd": 10_000, "source": "fast_flights"} for _ in range(9)]
    summary = summarize_price_history(rows, current_price=9_000)
    assert summary["sample_count"] == 9
    assert summary["judgement"] == "collecting"


def test_history_summary_marks_price_at_or_below_p20_as_recent_low():
    rows = [{"lowest_price_twd": price, "source": "fast_flights"} for price in range(10_000, 20_000, 1_000)]
    summary = summarize_price_history(rows, current_price=11_000)
    assert summary["sample_count"] == 10
    assert summary["p20"] == 11_800
    assert summary["judgement"] == "recent_low"
