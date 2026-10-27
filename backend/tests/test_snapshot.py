"""End-to-end check on the bundled Elexon snapshot (no network).

Simulates Elexon being down, so load_data() falls back to the snapshot, then runs the
full pipeline and pins the headline January figures quoted in the README.
"""
from datetime import time

import pytest
from app import analysis, elexon


def test_snapshot_fallback_reproduces_january_figures(monkeypatch):
    def elexon_down(*_):
        raise elexon.ElexonError("Elexon is down")

    monkeypatch.setattr(elexon, "_get", elexon_down)
    elexon.load_data.cache_clear()
    try:
        fc, act = elexon.load_data()
        assert elexon.source == "snapshot"
        errors = analysis.paired_errors(fc, act, time(9, 20), analysis.history_days())
        m = analysis.metrics(analysis.with_adjustment(errors))
    finally:
        elexon.load_data.cache_clear()

    assert m["n"] == 744
    assert m["bias"] == pytest.approx(1746, abs=1)
    assert m["mae"] == pytest.approx(2022, abs=1)
    assert m["adjusted"]["mae"] == pytest.approx(1494, abs=1)
    assert m["adjusted"]["band_coverage_pct"] == pytest.approx(81.6, abs=0.1)
