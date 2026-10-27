"""Tests on small synthetic frames (no network)."""
from datetime import date, time, timedelta

import pandas as pd
import pytest
from app import analysis

DAY = date(2026, 1, 15)


def ts(s: str) -> pd.Timestamp:
    return pd.Timestamp(s, tz="UTC")


def make_fc(runs: dict[str, float], hours: int = 24) -> pd.DataFrame:
    """One run per publish time; every hour of DAY (and a stray hour either side) = value."""
    rows = []
    for pub, value in runs.items():
        for h in range(-1, hours + 1):
            rows.append({
                "publish_time": ts(pub),
                "start_time": ts("2026-01-15 00:00") + pd.Timedelta(hours=h),
                "forecast": value,
            })
    return pd.DataFrame(rows)


RUNS = {"2026-01-14 04:30": 100.0, "2026-01-14 07:30": 200.0,
        "2026-01-14 09:30": 300.0, "2026-01-14 11:30": 400.0}


def test_picks_latest_run_before_decision():
    run, f = analysis.latest_forecast(make_fc(RUNS), DAY, time(9, 20))
    assert run == ts("2026-01-14 07:30")
    assert (f["forecast"] == 200).all()


def test_run_published_after_decision_is_excluded():
    # 09:30 is 10 minutes after the 09:20 gate, so it must not be used...
    run, _ = analysis.latest_forecast(make_fc(RUNS), DAY, time(9, 20))
    assert run != ts("2026-01-14 09:30")
    # ...but it is available for a 09:50 decision.
    run, _ = analysis.latest_forecast(make_fc(RUNS), DAY, time(9, 50))
    assert run == ts("2026-01-14 09:30")


def test_run_at_exact_decision_time_is_included():
    run, _ = analysis.latest_forecast(make_fc(RUNS), DAY, time(9, 30))
    assert run == ts("2026-01-14 09:30")


def test_no_run_available_raises():
    with pytest.raises(LookupError):
        analysis.latest_forecast(make_fc(RUNS), DAY, time(3, 0))


def test_slices_to_delivery_day_hours():
    _, f = analysis.latest_forecast(make_fc(RUNS), DAY, time(9, 20))
    assert len(f) == 24
    assert f["start_time"].min() == ts("2026-01-15 00:00")
    assert f["start_time"].max() == ts("2026-01-15 23:00")


def test_delivery_day_is_uk_local_across_dst():
    start, end = analysis.day_bounds(date(2026, 3, 29))  # clocks go forward
    assert (end - start) == pd.Timedelta(hours=23)
    assert start == ts("2026-03-29 00:00")  # GMT until 01:00 UTC


def test_paired_errors_and_metrics():
    fc = make_fc({"2026-01-14 07:30": 1000.0})
    starts = ts("2026-01-15 00:00") + pd.to_timedelta(range(24), unit="h")
    actual = [800.0] * 12 + [1300.0] * 12  # errors: +200 x12, -300 x12
    act = pd.DataFrame({"start_time": starts, "actual": actual})
    # An unrelated half-hour row must not be joined.
    act = pd.concat([act, pd.DataFrame({"start_time": [starts[0] + pd.Timedelta(minutes=30)],
                                        "actual": [0.0]})])
    err = analysis.paired_errors(fc, act, time(9, 20), days=[DAY])
    assert len(err) == 24
    assert err.loc[0, "error"] == 200  # forecast - actual: over-forecast is positive
    m = analysis.metrics(err)
    assert m["mae"] == pytest.approx(250)
    assert m["bias"] == pytest.approx(-50)
    assert m["rmse"] == pytest.approx(((200**2 + 300**2) / 2) ** 0.5)
    assert m["nmae_pct"] == pytest.approx(100 * 250 / 1050)
    assert sum(b["count"] for b in m["histogram"]) == 24
    assert len(m["by_hour"]) == 24 and len(m["by_day"]) == 1


def _errors_by_day(values: dict[date, float]) -> pd.DataFrame:
    """One hourly error row per hour, constant within each day."""
    rows = [{"day": d, "hour": h, "forecast": 1000.0 + e, "actual": 1000.0, "error": e}
            for d, e in values.items() for h in range(24)]
    return pd.DataFrame(rows)


def test_trailing_stats_never_look_ahead():
    # Deciding on 14 Jan for 15 Jan: 13 Jan is the last fully known day.
    first, last = analysis.trailing_window(DAY)
    assert last == date(2026, 1, 13)
    assert (last - first).days + 1 == analysis.TRAIL_DAYS
    in_window = pd.date_range(first, last).date
    errs = {d: 100.0 for d in in_window}
    errs[first - timedelta(1)] = errs[date(2026, 1, 14)] = errs[DAY] = 9999.0
    stats = analysis.trailing_stats(_errors_by_day(errs), DAY)
    assert stats == {"bias": 100.0, "p10": 100.0, "p90": 100.0}


def test_with_adjustment_removes_trailing_bias():
    # Constant +500 MW over-forecast every day: the adjusted forecast is exact and
    # the (zero-width) band contains every actual.
    days = analysis.history_days()
    df = analysis.with_adjustment(_errors_by_day({d: 500.0 for d in days}))
    assert set(df["day"]) == set(analysis.all_days())  # warm-up days are not scored
    assert (df["adj_error"] == 0).all() and df["in_band"].all()
    m = analysis.metrics(df)
    assert m["mae"] == 500 and m["adjusted"]["mae"] == 0
    assert m["adjusted"]["band_coverage_pct"] == 100
