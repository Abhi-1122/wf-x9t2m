const UK = "Europe/London";

export const mw = (v: number) => Math.round(v).toLocaleString("en-GB");
export const gw = (v: number, signed = false) =>
  `${signed && v > 0 ? "+" : ""}${(v / 1000).toFixed(2)}`;
export const mwh = (v: number) => Math.round(v).toLocaleString("en-GB");

/** "07:30" in UK local time. */
export const ukTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: UK,
    hour: "2-digit",
    minute: "2-digit",
  });

/** "14 Jan 07:30" in UK local time. */
export const ukDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: UK,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export const duration = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h} h ${m} min` : `${m} min`;
};

/** "18 Dec" from "2025-12-18". */
export const shortDate = (isoDate: string) =>
  new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** "Thursday 15 January 2026" from "2026-01-15". */
export const longDate = (isoDate: string) =>
  new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
