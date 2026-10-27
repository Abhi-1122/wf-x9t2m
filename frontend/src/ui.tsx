import type { ReactNode } from "react";

export function Kpi(props: { label: string; value: string; unit?: string; note?: ReactNode }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{props.label}</div>
      <div className="kpi-value">
        {props.value}
        {props.unit && <span className="kpi-unit"> {props.unit}</span>}
      </div>
      {props.note && <div className="kpi-note">{props.note}</div>}
    </div>
  );
}

export function Card(props: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="card">
      <h2>{props.title}</h2>
      {props.subtitle && <p className="subtitle">{props.subtitle}</p>}
      {props.children}
    </section>
  );
}

export function Legend(props: { items: { label: string; color: string; kind?: "line" | "box" | "dash" }[] }) {
  return (
    <ul className="legend">
      {props.items.map((i) => (
        <li key={i.label}>
          <span
            className={`swatch ${i.kind ?? "line"}`}
            style={i.kind === "dash" ? { color: i.color } : { background: i.color }}
          />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

export function Status(props: { loading: boolean; error?: string; hasData: boolean }) {
  if (props.error)
    return (
      <div className="status error" role="alert">
        <strong>Could not load data.</strong> {props.error}
      </div>
    );
  if (props.loading && !props.hasData)
    return (
      <div className="status" role="status">
        Loading data from Elexon. The first load takes a few seconds.
      </div>
    );
  return null;
}

export const COLORS = {
  forecast: "#2a78d6",
  adjusted: "#1baf7a",
  actual: "#eb6834",
  band: "#2a78d6",
  muted: "#8a8984",
  grid: "#e6e5e1",
};
