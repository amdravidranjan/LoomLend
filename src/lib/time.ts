// All scheduling rules run in campus time (IST, no daylight saving), regardless of
// where the server or the viewer is.
export const CAMPUS_TZ = "Asia/Kolkata";
const OFFSET = "+05:30";
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export function campusParts(ms: number) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CAMPUS_TZ,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: weekdays.indexOf(get("weekday")),
  };
}

/** "2026-10-29T10:00" interpreted as campus time. */
export function parseCampusLocal(value: string) {
  const ms = Date.parse(`${value}:00${OFFSET}`);
  return Number.isNaN(ms) ? null : ms;
}

export function toCampusLocalInput(ms: number) {
  const p = campusParts(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Start of the campus day containing ms, plus `hour` hours. */
export function campusDayAt(ms: number, hour: number) {
  const p = campusParts(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return Date.parse(`${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(hour)}:00:00${OFFSET}`);
}

export function fmtDateTime(ms: number | null | undefined) {
  if (!ms) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: CAMPUS_TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

export function fmtTime(ms: number) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: CAMPUS_TZ, hour: "numeric", minute: "2-digit" }).format(new Date(ms));
}

export function fmtDay(ms: number) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: CAMPUS_TZ, weekday: "short", day: "numeric", month: "short" }).format(
    new Date(ms),
  );
}

export function fmtRange(start: number, end: number) {
  return `${fmtDateTime(start)} – ${fmtTime(end)}`;
}

export function relative(ms: number, now = Date.now()) {
  const diff = ms - now;
  const abs = Math.abs(diff);
  const unit = abs < HOUR ? [Math.round(abs / 60000), "min"] : abs < DAY ? [Math.round(abs / HOUR), "h"] : [Math.round(abs / DAY), "d"];
  return diff >= 0 ? `in ${unit[0]} ${unit[1]}` : `${unit[0]} ${unit[1]} ago`;
}

/** Request-time clock for server components (all pages render per request). */
export function currentTime() {
  return Date.now();
}

export const DAY_NAMES =["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
