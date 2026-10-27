import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useApi, type DayResponse } from "./api";
import { duration, longDate, mw, mwh, shortDate, ukDateTime, ukTime } from "./format";
import { COLORS, Card, Kpi, Legend, Status } from "./ui";

export default function DayView({ date, decision }: { date: string; decision: string }) {
  const { data, error, loading } = useApi<DayResponse>(
    `/api/day?date=${date}&decision=${decision}`,
  );
  const status = <Status loading={loading} error={error} hasData={!!data} />;
  if (!data) return status;

  const rows = data.points.map((p, i) => ({
    ...p,
    band: [p.p10, p.p90],
    ...Object.fromEntries(data.later_runs.map((r, k) => [`run${k}`, r.forecast[i]])),
  }));
  const { kpis, run, trailing } = data;
  const trailWindow = `${shortDate(trailing.from)} to ${shortDate(trailing.to)}`;
  const hours = data.points.length;
  const missDelta =
    kpis.actual_mwh === null ? null : (kpis.energy_mwh - kpis.actual_mwh) / kpis.actual_mwh;

  return (
    <div className={loading ? "stale" : undefined}>
      {status}
      <div className="kpis">
        <Kpi
          label="Forecast run used"
          value={ukTime(run.publish_time)}
          note={`Published ${shortDate(run.publish_time.slice(0, 10))}, ${duration(run.age_minutes)} before the ${decision} decision and ${run.lead_hours.toFixed(1)} h before delivery starts`}
        />
        <Kpi
          label="Forecast wind energy"
          value={mwh(kpis.energy_mwh)}
          unit="MWh"
          note={
            <>
              Sum of the {hours} hourly forecasts
              {hours < 24 && <strong> (this run does not cover the last {24 - hours} h)</strong>}.
              Bias-adjusted: {mwh(kpis.adjusted_mwh)} MWh
            </>
          }
        />
        <Kpi
          label="Peak hour"
          value={mw(kpis.peak.mw)}
          unit="MW"
          note={`at ${ukTime(kpis.peak.time)}; minimum ${mw(kpis.min.mw)} MW at ${ukTime(kpis.min.time)}`}
        />
        <Kpi
          label="Shortfall buffer (P90)"
          value={mw(kpis.buffer_mw)}
          unit="MW"
          note={`In 9 of 10 hours over ${trailWindow}, wind fell short of the forecast by less than this`}
        />
        <Kpi
          label="Actual wind energy (hindsight)"
          value={kpis.actual_mwh === null ? "n/a" : mwh(kpis.actual_mwh)}
          unit={kpis.actual_mwh === null ? undefined : "MWh"}
          note={
            missDelta === null
              ? "Not all actuals are available"
              : `The forecast was ${Math.abs(missDelta * 100).toFixed(0)}% ${missDelta > 0 ? "too high" : "too low"}. Not known at decision time.`
          }
        />
      </div>

      <Card
        title={`Wind forecast for ${longDate(date)}`}
        subtitle={`The blue line is the forecast a trader has at the decision time. The dashed line removes the average error of the previous 14 delivery days (${trailWindow}). The shaded band spreads the forecast by the errors seen over the same days, so the actual should land inside it about 8 times in 10.`}
      >
        <Legend
          items={[
            { label: `Forecast used (${decision} decision)`, color: COLORS.forecast },
            { label: "Bias-adjusted forecast", color: COLORS.adjusted, kind: "dash" },
            { label: "P10 to P90 band", color: "rgba(42,120,214,0.2)", kind: "box" },
            { label: "Actual (known only in hindsight)", color: COLORS.actual },
            { label: "Later forecast runs", color: COLORS.muted },
          ]}
        />
        <ResponsiveContainer width="100%" height={380}>
          <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 24, left: 16 }}>
            <CartesianGrid stroke={COLORS.grid} vertical={false} />
            <XAxis
              dataKey="time"
              tickFormatter={ukTime}
              interval={1}
              tick={{ fontSize: 12 }}
              label={{ value: "Delivery hour (UK time)", position: "insideBottom", offset: -14 }}
            />
            <YAxis
              tickFormatter={mw}
              tick={{ fontSize: 12 }}
              label={{ value: "Wind generation (MW)", angle: -90, position: "insideLeft", offset: -4 }}
            />
            <Tooltip
              labelFormatter={(t) => `${ukTime(String(t))} UK time`}
              formatter={(v, name) => [
                Array.isArray(v) ? `${mw(v[0])} to ${mw(v[1])} MW` : `${mw(Number(v))} MW`,
                name,
              ]}
              itemSorter={() => 0}
            />
            <Area
              dataKey="band"
              name="P10 to P90 band"
              fill={COLORS.band}
              fillOpacity={0.18}
              stroke="none"
              isAnimationActive={false}
            />
            {data.later_runs.map((r, k) => (
              <Line
                key={r.publish_time}
                dataKey={`run${k}`}
                name={`Run published ${ukDateTime(r.publish_time)}`}
                stroke={COLORS.muted}
                strokeOpacity={0.45}
                strokeWidth={1}
                dot={false}
                isAnimationActive={false}
              />
            ))}
            <Line
              dataKey="actual"
              name="Actual"
              stroke={COLORS.actual}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="adjusted"
              name="Bias-adjusted forecast"
              stroke={COLORS.adjusted}
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="forecast"
              name={`Forecast used (run ${ukDateTime(run.publish_time)})`}
              stroke={COLORS.forecast}
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
        <p className="note">
          The band, buffer and bias adjustment use delivery days whose actuals were complete
          before the decision, so a trader could have computed them on the day. The Forecast
          accuracy tab checks how often the band contained the actual.
        </p>
      </Card>
    </div>
  );
}
