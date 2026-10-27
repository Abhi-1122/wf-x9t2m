"""Fetches wind actuals (FUELHH) and wind forecasts (WINDFOR) from Elexon BMRS.

The assignment window is fixed (decisions made in January 2026, plus two weeks of
December as warm-up for the trailing error statistics), so the whole dataset is
about 3.5 MB. It is fetched once per process and cached in memory.

If Elexon cannot be reached, the app falls back to a gzipped copy of the same data
in data/elexon_snapshot.json.gz. Refresh it with `python -m app.elexon` (from backend/).
"""
import gzip
import json
import logging
from functools import lru_cache
from pathlib import Path

import httpx
import pandas as pd

BASE = "https://data.elexon.co.uk/bmrs/api/v1/datasets"
TIMEOUT_S = 20
SNAPSHOT = Path(__file__).parent / "data" / "elexon_snapshot.json.gz"

PARAMS = {
    "WINDFOR": {
        "publishDateTimeFrom": "2025-12-15T00:00:00Z",
        "publishDateTimeTo": "2026-02-01T23:59:59Z",
    },
    "FUELHH": {"settlementDateFrom": "2025-12-17", "settlementDateTo": "2026-02-02",
               "fuelType": "WIND"},
}
COLUMNS = {"WINDFOR": ["publishTime", "startTime", "generation"],
           "FUELHH": ["startTime", "generation"]}

log = logging.getLogger(__name__)
source = "not loaded"  # "live" or "snapshot" once load_data() has run


class ElexonError(RuntimeError):
    """Raised when the Elexon API cannot be reached or returns unusable data."""


def _get(dataset: str, params: dict) -> pd.DataFrame:
    url = f"{BASE}/{dataset}/stream"
    try:
        resp = httpx.get(url, params=params, timeout=TIMEOUT_S)
        resp.raise_for_status()
        rows = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise ElexonError(f"Could not load {dataset} from Elexon: {exc}") from exc
    if not rows:
        raise ElexonError(f"Elexon returned no {dataset} data for the requested window.")
    return pd.DataFrame(rows)


def _fetch() -> dict[str, pd.DataFrame]:
    return {name: _get(name, PARAMS[name])[COLUMNS[name]] for name in PARAMS}


def _read_snapshot() -> dict[str, pd.DataFrame]:
    with gzip.open(SNAPSHOT, "rt") as f:
        return {name: pd.DataFrame(rows) for name, rows in json.load(f).items()}


@lru_cache(maxsize=1)
def load_data() -> tuple[pd.DataFrame, pd.DataFrame]:
    """Return (forecasts, actuals), timestamps in UTC.

    forecasts: publish_time, start_time, forecast   (MW, hourly)
    actuals:   start_time, actual                   (MW, half-hourly)
    """
    global source
    try:
        raw, source = _fetch(), "live"
    except ElexonError as exc:
        if not SNAPSHOT.exists():
            raise
        log.warning("%s Using the bundled snapshot instead.", exc)
        raw, source = _read_snapshot(), "snapshot"

    fc = raw["WINDFOR"].rename(columns={"publishTime": "publish_time", "startTime": "start_time",
                                        "generation": "forecast"}).dropna()
    act = raw["FUELHH"].rename(columns={"startTime": "start_time",
                                        "generation": "actual"}).dropna()
    for df in (fc, act):
        df["start_time"] = pd.to_datetime(df["start_time"], utc=True)
    fc["publish_time"] = pd.to_datetime(fc["publish_time"], utc=True)
    return fc, act


if __name__ == "__main__":
    SNAPSHOT.parent.mkdir(exist_ok=True)
    data = {name: df.to_dict("records") for name, df in _fetch().items()}
    with gzip.open(SNAPSHOT, "wt") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"Wrote {SNAPSHOT} ({SNAPSHOT.stat().st_size / 1e3:.0f} kB)")
