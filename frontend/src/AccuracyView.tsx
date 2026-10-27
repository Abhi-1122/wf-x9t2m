import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PRESETS } from "./App";
import { useApi, type AccuracyResponse } from "./api";
import { gw, mw } from "./format";
import { COLORS, Card, Kpi, Legend, Status } from "./ui";

const axis = { fontSize: 12 };
const yLabel = { value: "Error (MW)", angle: -90, position: "insideLeft", offset: -4 } as const;
const grid = <CartesianGrid stroke={COLORS.grid} vertical={false} />;
const errorSeries = [
  { label: "MAE (mean absolute error)", color: COLORS.forecast },
  { label: "Bias (mean error; positive = over-forecast)", color: COLORS.actual },
];

export default function AccuracyView({ decision }: { decision: string }) {
  const { data, error, loading } = useApi<AccuracyResponse>(`/api/accuracy?decision=${decision}`);
  const status = <Status loading={loading} error={error} hasData={!!data} />;
  if (!data) return status;

  const base = data.comparison.find((c) => c.decision === "09:20");
  const adj = data.adjusted;
  const gain = (1 - adj.mae / data.mae) * 100;
  const pctOfMean = (data.bias / data.mean_actual) * 100;
  const hours = data.by_hour.map((h) => ({ ...h, label: `${String(h.hour).padStart(2, "0")}:00` }));
  const days = data.by_day.map((d) => ({ ...d, label: d.day.slice(5) }));

  return (
    <div className={loading ? "stale" : undefined}>
      {status}
      <aside className="insight">
        <h2>What January shows for a {decision} decision</h2>
        <ul>
          <li>
            The forecast was <strong>{data.bias > 0 ? "too high" : "too low"} by{" "}
            {gw(Math.abs(data.bias))} GW on average</strong> ({Math.abs(pctOfMean).toFixed(0)}% of
            mean wind output).{" "}
            {data.bias > 0 &&
              "Buying against the raw forecast leaves the position short of power on average."}
          </li>
          <li>
            Removing the average error of the previous 14 days cuts the typical miss from{" "}
            {gw(data.mae)} to <strong>{gw(adj.mae)} GW ({gain.toFixed(0)}% better)</strong>, using
            data published before the decision.
          </li>
          <li>
            The P10 to P90 band contained the actual in{" "}
            <strong>{adj.band_coverage_pct.toFixed(0)}% of hours</strong> (80% expected), so it is
            a usable basis for sizing a buffer.
          </li>
        </ul>
      </aside>
      <div className="kpis">
        <Kpi
          label="MAE (typical miss)"
          value={gw(data.mae)}
          unit="GW"
          note={`${data.nmae_pct.toFixed(1)}% of mean wind output (${gw(data.mean_actual)} GW), ${data.n} hours`}
        />
        <Kpi
          label="Bias"
          value={gw(data.bias, true)}
          unit="GW"
          note={data.bias > 0 ? "Over-forecast on average" : "Under-forecast on average"}
        />
        <Kpi
          label="Bias-adjusted MAE"
          value={gw(adj.mae)}
          unit="GW"
          note={`${gain.toFixed(0)}% lower than the raw forecast`}
        />
        <Kpi
          label="Band coverage"
          value={adj.band_coverage_pct.toFixed(0)}
          unit="%"
          note="Hours inside the P10 to P90 band (80% expected)"
        />
      </div>

      <Card
        title="Decision-time comparison"
        subtitle="Same accuracy measures if the decision were taken at each auction gate. A later decision can use a fresher forecast run."
      >
        <table>
          <thead>
            <tr>
              <th>Decision time (UK)</th>
              <th>Hours</th>
              <th>MAE (MW)</th>
              <th>RMSE (MW)</th>
              <th>Bias (MW)</th>
              <th>nMAE (%)</th>
              <th>MAE vs 09:20</th>
              <th>Bias-adjusted MAE (MW)</th>
            </tr>
          </thead>
          <tbody>
            {data.comparison.map((c) => {
              const preset = PRESETS.find((p) => p.time === c.decision);
              const delta = base ? ((c.mae - base.mae) / base.mae) * 100 : 0;
              return (
                <tr key={c.decision} className={c.decision === decision ? "active" : undefined}>
                  <td>
                    <strong>{c.decision}</strong> {preset?.label ?? "Custom"}
                  </td>
                  <td>{c.n}</td>
                  <td>{mw(c.mae)}</td>
                  <td>{mw(c.rmse)}</td>
                  <td>{c.bias > 0 ? "+" : ""}{mw(c.bias)}</td>
                  <td>{c.nmae_pct.toFixed(1)}</td>
                  <td>{c.decision === "09:20" ? "baseline" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`}</td>
                  <td>{mw(c.adj_mae)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card
        title="Error by delivery hour"
        subtitle="Later hours are forecast further ahead of the decision, so this view mixes lead time with time-of-day effects."
      >
        <Legend items={errorSeries.map((s) => ({ ...s, kind: "box" as const }))} />
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={hours} margin={{ top: 8, right: 16, bottom: 24, left: 16 }}>
            {grid}
            <XAxis dataKey="label" tick={axis} interval={1}
              label={{ value: "Delivery hour (UK time)", position: "insideBottom", offset: -14 }} />
            <YAxis tickFormatter={mw} tick={axis} label={yLabel} />
            <Tooltip formatter={(v) => `${mw(Number(v))} MW`} />
            <ReferenceLine y={0} stroke={COLORS.muted} />
            <Bar isAnimationActive={false} dataKey="mae" name="MAE" fill={COLORS.forecast} radius={[3, 3, 0, 0]} />
            <Bar isAnimationActive={false} dataKey="bias" name="Bias" fill={COLORS.actual} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="Daily error across January" subtitle="One point per delivery day.">
        <Legend
          items={[
            ...errorSeries,
            { label: "Bias-adjusted MAE", color: COLORS.adjusted, kind: "dash" as const },
          ]}
        />
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={days} margin={{ top: 8, right: 16, bottom: 24, left: 16 }}>
            {grid}
            <XAxis dataKey="label" tick={axis} interval={2}
              label={{ value: "Delivery day (MM-DD)", position: "insideBottom", offset: -14 }} />
            <YAxis tickFormatter={mw} tick={axis} label={yLabel} />
            <Tooltip formatter={(v) => `${mw(Number(v))} MW`} />
            <ReferenceLine y={0} stroke={COLORS.muted} />
            <Line isAnimationActive={false} dataKey="mae" name="MAE" stroke={COLORS.forecast} strokeWidth={2} dot={{ r: 3 }} />
            <Line isAnimationActive={false} dataKey="bias" name="Bias" stroke={COLORS.actual} strokeWidth={2} dot={{ r: 3 }} />
            <Line isAnimationActive={false} dataKey="adj_mae" name="Bias-adjusted MAE" stroke={COLORS.adjusted} strokeWidth={2} strokeDasharray="6 4" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Card
        title="Error distribution"
        subtitle="Hourly errors in 1,000 MW bins. Orange bins are over-forecasts (wind below forecast); blue bins are under-forecasts."
      >
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data.histogram} margin={{ top: 8, right: 16, bottom: 24, left: 16 }}>
            {grid}
            <XAxis dataKey="from" tick={axis} tickFormatter={mw}
              label={{ value: "Error = forecast - actual, bin start (MW)", position: "insideBottom", offset: -14 }} />
            <YAxis tick={axis} allowDecimals={false}
              label={{ value: "Hours", angle: -90, position: "insideLeft", offset: -4 }} />
            <Tooltip
              labelFormatter={(from) => `${mw(Number(from))} to ${mw(Number(from) + 1000)} MW`}
              formatter={(v) => [`${v} hours`, "Count"]}
            />
            <Bar isAnimationActive={false} dataKey="count" radius={[3, 3, 0, 0]}>
              {data.histogram.map((b) => (
                <Cell key={b.from} fill={b.from >= 0 ? COLORS.actual : COLORS.forecast} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <details className="card method">
        <summary>How these numbers are calculated</summary>
        <ul>
          <li>
            <strong>Forecast used:</strong> for each delivery day, the latest Elexon WINDFOR run
            published at or before the decision time on the day before.
          </li>
          <li>
            <strong>Actual:</strong> Elexon FUELHH wind output for the half-hour starting on the
            hour, matched to the hourly forecast.
          </li>
          <li>
            <strong>Error</strong> = forecast minus actual. MAE is the average size of the miss,
            RMSE weights large misses more, and bias is the average signed miss.
          </li>
          <li>
            <strong>Bias adjustment and band:</strong> taken from the 14 delivery days before the
            day before delivery, the last days fully known at decision time. No future data is
            used.
          </li>
        </ul>
      </details>
    </div>
  );
}
