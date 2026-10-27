"""Pure analysis functions (no I/O). Sign convention: error = forecast - actual.

A positive error means wind was over-forecast, so the trader had to buy more.
All inputs/outputs use UTC timestamps; the "decision time" and delivery days are
interpreted in UK local time (Europe/London), so the code stays correct across DST.
"""
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

LONDON = ZoneInfo("Europe/London")
FIRST_DAY = date(2026, 1, 2)  # first delivery day (decision on 1 Jan)
LAST_DAY = date(2026, 2, 1)   # last delivery day (decision on 31 Jan)
HIST_BIN_MW = 1000
# Uncertainty and bias are learnt from the last TRAIL_DAYS delivery days whose actuals
# are complete at decision time. Deciding on D-1, that is days D-1-TRAIL_DAYS .. D-2.
TRAIL_DAYS = 14


def all_days() -> list[date]:
    return [FIRST_DAY + timedelta(n) for n in range((LAST_DAY - FIRST_DAY).days + 1)]


def history_days() -> list[date]:
    """all_days() plus the warm-up days needed for the first day's trailing window."""
    first = FIRST_DAY - timedelta(TRAIL_DAYS + 1)
    return [first + timedelta(n) for n in range((LAST_DAY - first).days + 1)]


def _utc(d: date, t: time) -> pd.Timestamp:
    return pd.Timestamp(datetime.combine(d, t, tzinfo=LONDON)).tz_convert("UTC")


def decision_cutoff(day: date, decision: time) -> pd.Timestamp:
    """The moment the decision is made: `decision` UK time on the day before `day`."""
    return _utc(day - timedelta(days=1), decision)


def day_bounds(day: date) -> tuple[pd.Timestamp, pd.Timestamp]:
    """[start, end) of the UK delivery day in UTC (23-25 hours around DST changes)."""
    return _utc(day, time()), _utc(day + timedelta(days=1), time())


def latest_forecast(
    fc: pd.DataFrame, day: date, decision: time
) -> tuple[pd.Timestamp, pd.DataFrame]:
    """Latest run published at or before the decision time, sliced to the delivery day.

    Returns (publish_time, frame[start_time, forecast]). Raises LookupError if no run
    had been published yet.
    """
    cutoff = decision_cutoff(day, decision)
    published = fc.loc[fc["publish_time"] <= cutoff, "publish_time"]
    if published.empty:
        raise LookupError(f"No forecast published before {cutoff:%Y-%m-%d %H:%M}Z")
    run = published.max()
    start, end = day_bounds(day)
    rows = fc[(fc["publish_time"] == run) & (fc["start_time"] >= start) & (fc["start_time"] < end)]
    return run, rows[["start_time", "forecast"]].sort_values("start_time").reset_index(drop=True)


def paired_errors(
    fc: pd.DataFrame, act: pd.DataFrame, decision: time, days: list[date] | None = None
) -> pd.DataFrame:
    """Forecast vs actual for every delivery day, one row per hour.

    Joins on the hourly start_time: the actual is the FUELHH half-hour that starts at
    HH:00 (the second half-hour of each hour is not used). Columns: day, start_time,
    hour (UK local hour), forecast, actual, error.
    """
    frames = []
    for day in all_days() if days is None else days:
        _, f = latest_forecast(fc, day, decision)
        f.insert(0, "day", day)
        frames.append(f)
    df = pd.concat(frames).merge(act, on="start_time", how="inner")
    df["hour"] = df["start_time"].dt.tz_convert(LONDON).dt.hour
    df["error"] = df["forecast"] - df["actual"]
    return df.reset_index(drop=True)


def trailing_window(day: date) -> tuple[date, date]:
    """First and last delivery day whose errors are known when deciding for `day`."""
    return day - timedelta(TRAIL_DAYS + 1), day - timedelta(2)


def trailing_stats(errors: pd.DataFrame, day: date) -> dict:
    """Bias and P10/P90 of the error over the trailing window: no look-ahead."""
    first, last = trailing_window(day)
    e = errors.loc[(errors["day"] >= first) & (errors["day"] <= last), "error"]
    if e.empty:
        raise LookupError(f"No history available before {day}")
    return {"bias": float(e.mean()), "p10": float(e.quantile(0.1)),
            "p90": float(e.quantile(0.9))}


def with_adjustment(errors: pd.DataFrame) -> pd.DataFrame:
    """Add out-of-sample columns to a paired_errors frame (January days only).

    adj_forecast = forecast - trailing bias; band_lo/band_hi = P10/P90 of the actual,
    i.e. forecast - trailing P90/P10 of the error.
    """
    days = [d for d in all_days() if d in set(errors["day"])]
    stats = pd.DataFrame([{"day": d, **trailing_stats(errors, d)} for d in days])
    df = errors.merge(stats, on="day")
    df["adj_forecast"] = df["forecast"] - df["bias"]
    df["adj_error"] = df["adj_forecast"] - df["actual"]
    df["band_lo"] = df["forecast"] - df["p90"]
    df["band_hi"] = df["forecast"] - df["p10"]
    df["in_band"] = df["actual"].between(df["band_lo"], df["band_hi"])
    return df.drop(columns=["bias", "p10", "p90"])


def _summary(e: pd.Series) -> dict:
    return {"mae": float(e.abs().mean()), "bias": float(e.mean())}


def metrics(errors: pd.DataFrame) -> dict:
    """Accuracy summary of a paired_errors frame (all values in MW)."""
    e = errors["error"]
    mean_actual = float(errors["actual"].mean())
    mae = float(e.abs().mean())
    lo = int(np.floor(e.min() / HIST_BIN_MW)) * HIST_BIN_MW
    hi = int(np.ceil(e.max() / HIST_BIN_MW)) * HIST_BIN_MW
    edges = np.arange(lo, max(hi, lo + HIST_BIN_MW) + 1, HIST_BIN_MW)
    counts, _ = np.histogram(e, bins=edges)
    return {
        "n": int(len(e)),
        "mae": mae,
        "rmse": float(np.sqrt((e**2).mean())),
        "bias": float(e.mean()),
        "mean_actual": mean_actual,
        "nmae_pct": 100 * mae / mean_actual,
        "abs_p50": float(e.abs().quantile(0.5)),
        "abs_p90": float(e.abs().quantile(0.9)),
        "p10": float(e.quantile(0.1)),
        "p50": float(e.quantile(0.5)),
        "p90": float(e.quantile(0.9)),
        "histogram": [
            {"from": int(a), "to": int(a + HIST_BIN_MW), "count": int(c)}
            for a, c in zip(edges[:-1], counts, strict=True)
        ],
        "by_hour": [
            {"hour": int(h), **_summary(g["error"])} for h, g in errors.groupby("hour")
        ],
        "by_day": [
            {"day": d.isoformat(), **_summary(g["error"]),
             **({"adj_mae": float(g["adj_error"].abs().mean())} if "adj_error" in g else {})}
            for d, g in errors.groupby("day")
        ],
        **(_adjusted(errors) if "adj_error" in errors else {}),
    }


def _adjusted(errors: pd.DataFrame) -> dict:
    a = errors["adj_error"]
    return {"adjusted": {
        "mae": float(a.abs().mean()),
        "rmse": float(np.sqrt((a**2).mean())),
        "bias": float(a.mean()),
        "band_coverage_pct": 100 * float(errors["in_band"].mean()),
    }}
