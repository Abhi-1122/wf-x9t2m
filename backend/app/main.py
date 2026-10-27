"""FastAPI app: JSON API under /api, plus the built frontend when it exists."""
import re
from datetime import date, time
from functools import lru_cache
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import analysis, elexon
from .elexon import ElexonError, load_data

# Decision-time presets shown in the comparison table (gate closures, UK time).
PRESETS = ["09:20", "09:50", "15:30"]
DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"

app = FastAPI(title="GateWind: UK day-ahead wind forecast monitor")


@app.exception_handler(ElexonError)
async def elexon_error(_, exc: ElexonError):
    return JSONResponse(status_code=502, content={"detail": str(exc)})


def _decision(text: str) -> time:
    if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", text):
        raise HTTPException(422, "decision must be HH:MM (24-hour, UK time)")
    return time.fromisoformat(text)


def _day(text: str) -> date:
    try:
        d = date.fromisoformat(text)
    except ValueError:
        raise HTTPException(422, "date must be YYYY-MM-DD") from None
    if not analysis.FIRST_DAY <= d <= analysis.LAST_DAY:
        raise HTTPException(
            422, f"date must be between {analysis.FIRST_DAY} and {analysis.LAST_DAY}"
        )
    return d


@lru_cache(maxsize=64)
def _history(decision: str) -> pd.DataFrame:
    """Hourly errors for January plus the December warm-up days."""
    fc, act = load_data()
    return analysis.paired_errors(fc, act, _decision(decision), analysis.history_days())


@lru_cache(maxsize=64)
def _errors(decision: str) -> pd.DataFrame:
    """January errors with the out-of-sample adjusted forecast and band."""
    return analysis.with_adjustment(_history(decision))


def _list(s: pd.Series) -> list:
    return s.astype(object).where(s.notna(), None).tolist()


@app.get("/api/health")
def health():
    return {"status": "ok", "data_source": elexon.source,
            "snapshot_available": elexon.SNAPSHOT.exists()}


@app.get("/api/day")
def day(date: str, decision: str = "09:20"):
    d, t = _day(date), _decision(decision)
    fc, act = load_data()
    run, f = analysis.latest_forecast(fc, d, t)
    cutoff = analysis.decision_cutoff(d, t)
    start, _ = analysis.day_bounds(d)
    trail = analysis.trailing_stats(_history(decision), d)
    first, last = analysis.trailing_window(d)

    f = f.merge(act, on="start_time", how="left")
    f["adjusted"] = f["forecast"] - trail["bias"]
    # Actual = forecast - error, so the trailing error quantiles give the band.
    f["p10"] = f["forecast"] - trail["p90"]
    f["p90"] = f["forecast"] - trail["p10"]
    peak, low = f.loc[f["forecast"].idxmax()], f.loc[f["forecast"].idxmin()]

    # Runs published after the decision but before the delivery day starts.
    later = fc[(fc["publish_time"] > cutoff) & (fc["publish_time"] < start)]
    later_runs = []
    for pub, g in later.groupby("publish_time"):
        vals = g.set_index("start_time")["forecast"].reindex(f["start_time"])
        values = _list(vals.reset_index(drop=True))
        later_runs.append({"publish_time": pub.isoformat(), "forecast": values})

    buffer_mw = max(trail["p90"], 0.0)
    actual_mwh = float(f["actual"].sum()) if f["actual"].notna().all() else None
    return {
        "date": date,
        "decision": decision,
        "run": {
            "publish_time": run.isoformat(),
            "age_minutes": (cutoff - run).total_seconds() / 60,
            "lead_hours": (start - run).total_seconds() / 3600,
        },
        "kpis": {
            "energy_mwh": float(f["forecast"].sum()),  # hourly MW x 1 h
            "peak": {"time": peak["start_time"].isoformat(), "mw": float(peak["forecast"])},
            "min": {"time": low["start_time"].isoformat(), "mw": float(low["forecast"])},
            "adjusted_mwh": float(f["adjusted"].sum()),
            "actual_mwh": actual_mwh,
            "buffer_mw": buffer_mw,
        },
        "trailing": {"from": first.isoformat(), "to": last.isoformat(), **trail},
        "points": [
            {
                "time": r.start_time.isoformat(),
                "forecast": r.forecast,
                "adjusted": r.adjusted,
                "actual": None if pd.isna(r.actual) else r.actual,
                "p10": r.p10,
                "p90": r.p90,
            }
            for r in f.itertuples()
        ],
        "later_runs": later_runs,
    }


@app.get("/api/accuracy")
def accuracy(decision: str = "09:20"):
    _decision(decision)
    comparison = []
    for p in dict.fromkeys([*PRESETS, decision]):
        m = analysis.metrics(_errors(p))
        keep = ("n", "mae", "rmse", "bias", "nmae_pct")
        comparison.append({"decision": p, **{k: m[k] for k in keep},
                           "adj_mae": m["adjusted"]["mae"]})
    return {"decision": decision, **analysis.metrics(_errors(decision)), "comparison": comparison}


if DIST.is_dir():  # mounted last so /api routes win
    app.mount("/", StaticFiles(directory=DIST, html=True), name="frontend")
