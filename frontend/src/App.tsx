import { useState } from "react";
import AccuracyView from "./AccuracyView";
import DayView from "./DayView";

export const PRESETS = [
  { time: "09:20", label: "EPEX GB hourly auction" },
  { time: "09:50", label: "N2EX hourly auction" },
  { time: "15:30", label: "EPEX GB half-hourly auction" },
];

const FIRST_DAY = "2026-01-02";
const LAST_DAY = "2026-02-01";

/** Shift a YYYY-MM-DD date by n days. */
const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

export default function App() {
  const [tab, setTab] = useState<"day" | "accuracy">("day");
  const [decision, setDecision] = useState("09:20");
  const [custom, setCustom] = useState(false);
  const [date, setDate] = useState("2026-01-15");

  return (
    <>
      <header className="topbar">
        <div className="wrap">
          <h1>UK Day-Ahead Wind Forecast Monitor</h1>
          <p>
            Latest Elexon wind forecast available at decision time, and how accurate it has been.
            Decisions made in January 2026. All times are UK time.
          </p>
        </div>
      </header>

      <main className="wrap">
        <nav className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "day"} onClick={() => setTab("day")}>
            Day-ahead view
          </button>
          <button role="tab" aria-selected={tab === "accuracy"} onClick={() => setTab("accuracy")}>
            Forecast accuracy
          </button>
        </nav>

        <div className="controls">
          {tab === "day" && (
            <label className="field">
              <span>Delivery day</span>
              <div className="daynav">
                <button
                  aria-label="Previous day"
                  disabled={date <= FIRST_DAY}
                  onClick={() => setDate(addDays(date, -1))}
                >
                  ‹
                </button>
                <input
                  type="date"
                  value={date}
                  min={FIRST_DAY}
                  max={LAST_DAY}
                  onChange={(e) => e.target.value && setDate(e.target.value)}
                />
                <button
                  aria-label="Next day"
                  disabled={date >= LAST_DAY}
                  onClick={() => setDate(addDays(date, 1))}
                >
                  ›
                </button>
              </div>
            </label>
          )}
          <div className="field">
            <span>Decision time on the day before (UK time)</span>
            <div className="segmented">
              {PRESETS.map((p) => (
                <button
                  key={p.time}
                  aria-pressed={!custom && decision === p.time}
                  onClick={() => {
                    setCustom(false);
                    setDecision(p.time);
                  }}
                >
                  <strong>{p.time}</strong> {p.label}
                </button>
              ))}
              <button aria-pressed={custom} onClick={() => setCustom(true)}>
                Custom
              </button>
              {custom && (
                <input
                  type="time"
                  aria-label="Custom decision time"
                  value={decision}
                  onChange={(e) => e.target.value && setDecision(e.target.value)}
                />
              )}
            </div>
          </div>
        </div>

        {tab === "day" ? (
          <DayView date={date} decision={decision} />
        ) : (
          <AccuracyView decision={decision} />
        )}

        <footer className="footnote">
          Source: Elexon BMRS, FUELHH (actual wind, half-hourly) and WINDFOR (wind forecast,
          hourly). Error = forecast minus actual: a positive error means wind was over-forecast,
          so more non-wind power had to be bought.
        </footer>
      </main>
    </>
  );
}
