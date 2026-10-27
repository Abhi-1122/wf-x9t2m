import { useEffect, useState } from "react";

export interface DayResponse {
  date: string;
  decision: string;
  run: { publish_time: string; age_minutes: number; lead_hours: number };
  kpis: {
    energy_mwh: number;
    adjusted_mwh: number;
    actual_mwh: number | null;
    peak: { time: string; mw: number };
    min: { time: string; mw: number };
    buffer_mw: number;
  };
  trailing: { from: string; to: string; bias: number; p10: number; p90: number };
  points: {
    time: string;
    forecast: number;
    adjusted: number;
    actual: number | null;
    p10: number;
    p90: number;
  }[];
  later_runs: { publish_time: string; forecast: (number | null)[] }[];
}

export interface Summary {
  n: number;
  mae: number;
  rmse: number;
  bias: number;
  nmae_pct: number;
}

export interface AccuracyResponse extends Summary {
  decision: string;
  mean_actual: number;
  abs_p50: number;
  abs_p90: number;
  p10: number;
  p50: number;
  p90: number;
  histogram: { from: number; to: number; count: number }[];
  by_hour: { hour: number; mae: number; bias: number }[];
  by_day: { day: string; mae: number; bias: number; adj_mae: number }[];
  adjusted: { mae: number; rmse: number; bias: number; band_coverage_pct: number };
  comparison: ({ decision: string; adj_mae: number } & Summary)[];
}

interface State<T> {
  data?: T;
  error?: string;
  loading: boolean;
}

/** GET a JSON endpoint; re-fetches when the url changes and ignores stale responses. */
export function useApi<T>(url: string): State<T> {
  const [state, setState] = useState<State<T>>({ loading: true });
  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ data: s.data, loading: true }));
    fetch(url, { signal: ctrl.signal })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.detail ?? `Request failed (${r.status})`);
        setState({ data: body as T, loading: false });
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") setState({ error: e.message, loading: false });
      });
    return () => ctrl.abort();
  }, [url]);
  return state;
}
