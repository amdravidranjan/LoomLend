// Deterministic, explainable parser for booking requests in plain English.
// Used by the concierge's basic mode (no API key) and to pre-fill purposes in both modes.
// Pure: no database or server-only imports so it can be unit-tested.
import type { Booking } from "@/db/schema";
import { DAY, campusParts, parseCampusLocal, toCampusLocalInput } from "./time";

export type PartOfDay = "morning" | "afternoon" | "evening";
export const PARTS_OF_DAY: Record<PartOfDay, [number, number]> = {
  morning: [8, 12],
  afternoon: [12, 18],
  evening: [17, 22],
};

export type PolicyTopic =
  | "fair_share"
  | "priority"
  | "waitlist"
  | "rounds"
  | "supervision"
  | "training"
  | "strikes"
  | "deposits"
  | "horizon"
  | "open_requests";

export type Intent = {
  kind: "find" | "my_bookings" | "policy";
  policyTopic?: PolicyTopic;
  /** Keywords left after removing dates, times and filler, for resource matching. */
  query: string;
  /** Campus dates, YYYY-MM-DD, inclusive. Undefined = not mentioned. */
  fromDate?: string;
  toDate?: string;
  dateLabel?: string;
  partOfDay?: PartOfDay;
  /** Minutes after campus midnight. */
  startMinutes?: number;
  endMinutes?: number;
  /** "at 3pm" = this exact start; "after 3pm" = no earlier than. */
  exactStart?: boolean;
  durationHours?: number;
  purposeType?: Booking["purposeType"];
  category?: "space" | "equipment" | "tool" | "device";
};

// ------------------------------------------------------------------ date helpers

export function dayKey(ms: number) {
  return toCampusLocalInput(ms).slice(0, 10);
}
export function dayStartOf(key: string) {
  return parseCampusLocal(`${key}T00:00`)!;
}
export function addDays(key: string, n: number) {
  return dayKey(dayStartOf(key) + n * DAY + 12 * 3_600_000);
}
export function weekdayOf(key: string) {
  return campusParts(dayStartOf(key) + 12 * 3_600_000).weekday;
}
export function fmtDayKey(key: string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" }).format(
    new Date(dayStartOf(key) + 12 * 3_600_000),
  );
}
export function hhmm(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
export function fmtMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

const WEEKDAYS: [RegExp, number][] = [
  [/^sun(day)?$/, 0],
  [/^mon(day)?$/, 1],
  [/^tue(s|sday)?$/, 2],
  [/^wed(nesday)?$/, 3],
  [/^thu(r|rs|rsday)?$/, 4],
  [/^fri(day)?$/, 5],
  [/^sat(urday)?$/, 6],
];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAY_RE = "(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)";
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

function weekdayIndex(word: string) {
  return WEEKDAYS.find(([re]) => re.test(word))?.[1] ?? -1;
}

/** The next date (on or after today, or strictly after with `strict`) falling on `weekday`. */
function nextWeekday(today: string, weekday: number, strict: boolean) {
  const cur = weekdayOf(today);
  let diff = (weekday - cur + 7) % 7;
  if (diff === 0 && strict) diff = 7;
  return addDays(today, diff);
}

function explicitDate(today: string, day: number, monthIdx: number, year?: number) {
  const ty = Number(today.slice(0, 4));
  let y = year ?? ty;
  const key = `${y}-${String(monthIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!year && dayStartOf(key) < dayStartOf(today) - DAY) y += 1; // "5 Jan" in October means next year
  return `${y}-${String(monthIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ------------------------------------------------------------------ the parser

const NUM_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

const FILLER = new Set(
  "please can could would will should you u i me my we our us need needs want wants like to book booking reserve reservation slot slots free available availability time some any get find show let know is are there it its for on at in the a an and or from between of with this next week weekend today tomorrow tonight day days hour hours hr hrs h minutes mins min am pm morning afternoon evening noon around about after before by until till upto up use using do does have has anything something help what instead show make same other else also how which one ones option options more less longer shorter hey hi hello thanks thank ok okay actually just".split(
    " ",
  ),
);

function to24(h: number, mer?: string | null) {
  if (mer === "pm" && h < 12) return h + 12;
  if (mer === "am" && h === 12) return 0;
  return h;
}
/** Bare hours with no am/pm: campus hours run 8–22, so 1–7 means pm. */
function guessHour(h: number) {
  return h >= 1 && h <= 7 ? h + 12 : h;
}

export function parseIntent(text: string, now: number): Intent {
  const today = dayKey(now);
  let s = ` ${text.toLowerCase().replace(/[’']/g, "'").replace(/[–—]/g, "-").replace(/\s+/g, " ")} `;
  const intent: Intent = { kind: "find", query: "" };
  const cut = (re: RegExp) => {
    s = s.replace(re, " ");
  };

  // --- kind
  if (/\b(my|i have|i've|have i)\b.{0,20}\b(bookings?|requests?|reservations?|booked|slots?)\b|\bwhat (have|did) i (book|request)/.test(s)) {
    intent.kind = "my_bookings";
  }
  const topic: [RegExp, PolicyTopic][] = [
    [/waiting ?list|wait ?list|waitlist/, "waitlist"],
    [/fair[- ]?share|weekly cap|\bcap\b|hour limit/, "fair_share"],
    [/priority|score|who gets/, "priority"],
    [/lottery|draw|rounds?\b/, "rounds"],
    [/supervis/, "supervision"],
    [/training|certif|induction|qualif/, "training"],
    [/strikes?|suspend|ban/, "strikes"],
    [/deposit/, "deposits"],
    [/how far|in advance|ahead of time|horizon/, "horizon"],
    [/open requests?|how many requests|request limit/, "open_requests"],
  ];
  const asks = /\b(how|what|why|explain|when|policy|rules?)\b/.test(s);
  for (const [re, t] of topic) {
    if (re.test(s) && asks && intent.kind === "find") {
      intent.kind = "policy";
      intent.policyTopic = t;
      break;
    }
  }

  // --- purpose type
  if (/\b(research|thesis|ph\.?d|paper|experiment|publication|dissertation|synthesis)\b/.test(s)) intent.purposeType = "research";
  else if (/\b(assignment|coursework|course|lab record|class|semester|exam|practical)\b|\b[a-z]{2}\d{4}\b/.test(s)) intent.purposeType = "coursework";
  else if (/\b(project|club|capstone|hackathon|startup|competition|fest|documentary|workshop|pitch|interview)\b/.test(s)) intent.purposeType = "project";
  else if (/\b(personal|hobby|for fun|myself|self[- ]study)\b/.test(s)) intent.purposeType = "personal";

  // --- category
  if (/\b(room|space|hall|venue)\b/.test(s)) intent.category = "space";

  // --- duration
  const dur = s.match(/\b(\d+(?:\.\d+)?|an?|one|two|three|four|five|six|seven|eight)\s*(?:-|\s)?(?:hours?|hrs?|h)\b(\s*and a half)?/);
  if (/\bhalf an? hour\b/.test(s)) {
    intent.durationHours = 0.5;
    cut(/\bhalf an? hour\b/);
  } else if (/\b(an? )?hour and a half\b/.test(s)) {
    intent.durationHours = 1.5;
    cut(/\b(an? )?hour and a half\b/);
  } else if (dur) {
    const n = NUM_WORDS[dur[1]] ?? Number(dur[1]);
    intent.durationHours = n + (dur[2] ? 0.5 : 0);
    cut(new RegExp(dur[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } else {
    const mins = s.match(/\b(\d+)\s*(?:minutes?|mins?)\b/);
    if (mins) {
      intent.durationHours = Math.max(0.5, Math.round((Number(mins[1]) / 60) * 2) / 2);
      cut(/\b(\d+)\s*(?:minutes?|mins?)\b/);
    }
  }
  if (/\b(all day|full day|whole day)\b/.test(s)) {
    intent.durationHours = intent.durationHours ?? 8;
    cut(/\b(all day|full day|whole day)\b/);
  }

  // --- dates (before times, so "28/10" is not read as a time)
  let m: RegExpMatchArray | null;
  const setDay = (key: string, label?: string) => {
    intent.fromDate = key;
    intent.toDate = key;
    intent.dateLabel = label ?? fmtDayKey(key);
  };
  if ((m = s.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\b(?:\\s+(\\d{4}))?`)))) {
    setDay(explicitDate(today, Number(m[1]), MONTHS.indexOf(m[2].slice(0, 3)), m[3] ? Number(m[3]) : undefined));
    cut(new RegExp(m[0]));
  } else if ((m = s.match(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`)))) {
    setDay(explicitDate(today, Number(m[2]), MONTHS.indexOf(m[1].slice(0, 3)), m[3] ? Number(m[3]) : undefined));
    cut(new RegExp(m[0]));
  } else if ((m = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    const yr = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : undefined;
    const d = Number(m[1]);
    const mo = Number(m[2]);
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) setDay(explicitDate(today, d, mo - 1, yr));
    cut(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  } else if (/\bday after tomorrow\b/.test(s)) {
    setDay(addDays(today, 2));
    cut(/\bday after tomorrow\b/);
  } else if (/\b(tomorrow|tmrw|tmr)\b/.test(s)) {
    setDay(addDays(today, 1), `tomorrow (${fmtDayKey(addDays(today, 1))})`);
    cut(/\b(tomorrow|tmrw|tmr)\b/);
  } else if (/\btonight\b/.test(s)) {
    setDay(today, `tonight (${fmtDayKey(today)})`);
    intent.partOfDay = "evening";
    cut(/\btonight\b/);
  } else if (/\btoday\b|\bthis (morning|afternoon|evening)\b|\bnow\b|\basap\b/.test(s)) {
    setDay(today, `today (${fmtDayKey(today)})`);
    cut(/\btoday\b|\bnow\b|\basap\b/);
  } else if ((m = s.match(/\bin (\d+|a|one|two|three|four|five|six) days?\b/))) {
    const n = NUM_WORDS[m[1]] ?? Number(m[1]);
    setDay(addDays(today, n));
    cut(new RegExp(m[0]));
  } else if ((m = s.match(new RegExp(`\\b(next|this|coming)?\\s*${WEEKDAY_RE}\\b`)))) {
    const wd = weekdayIndex(m[2]);
    // "Friday" / "this Friday" / "next Friday" all mean the soonest Friday after today
    // (today itself only for a bare/"this" weekday that is today).
    const key = nextWeekday(today, wd, m[1] === "next");
    setDay(key);
    cut(new RegExp(m[0]));
  } else if (/\bnext week\b/.test(s)) {
    const mon = nextWeekday(today, 1, true);
    intent.fromDate = mon;
    intent.toDate = addDays(mon, 6);
    intent.dateLabel = `next week (${fmtDayKey(mon)} – ${fmtDayKey(addDays(mon, 6))})`;
    cut(/\bnext week\b/);
  } else if (/\bthis week\b/.test(s)) {
    const sun = nextWeekday(today, 0, false);
    intent.fromDate = today;
    intent.toDate = sun;
    intent.dateLabel = "this week";
    cut(/\bthis week\b/);
  } else if (/\b(this |next |the )?weekend\b/.test(s)) {
    const sat = nextWeekday(today, 6, /next weekend/.test(s));
    intent.fromDate = sat;
    intent.toDate = addDays(sat, 1);
    intent.dateLabel = `the weekend (${fmtDayKey(sat)} – ${fmtDayKey(addDays(sat, 1))})`;
    cut(/\b(this |next |the )?weekend\b/);
  }

  // --- part of day
  if (!intent.partOfDay) {
    if (/\bmorning\b/.test(s)) intent.partOfDay = "morning";
    else if (/\b(afternoon|after lunch|post lunch)\b/.test(s)) intent.partOfDay = "afternoon";
    else if (/\b(evening|night|after class(es)?)\b/.test(s)) intent.partOfDay = "evening";
  }

  // --- explicit times
  const T = "(\\d{1,2})(?:[:.](\\d{2}))?\\s*(am|pm|noon)?\\b";
  const range = s.match(new RegExp(`\\b(from|between)?\\s*${T}\\s*(?:-|to|till|until|and)\\s*${T}`));
  const valid = (r: RegExpMatchArray) => Boolean(r[1] || r[3] || r[4] || r[6] || r[7]);
  if (range && valid(range) && Number(range[2]) <= 24 && Number(range[5]) <= 24) {
    const endMer = range[7] === "noon" ? "pm" : range[7];
    let startMer = range[4] === "noon" ? "pm" : range[4];
    let eh = Number(range[5]);
    let sh = Number(range[2]);
    if (!startMer && endMer) {
      const endH = to24(eh, endMer);
      startMer = to24(sh, endMer) <= endH ? endMer : endMer === "pm" ? "am" : "pm";
    }
    sh = startMer ? to24(sh, startMer) : guessHour(sh);
    eh = endMer ? to24(eh, endMer) : guessHour(eh);
    if (eh <= sh && !endMer) eh += 12;
    intent.startMinutes = sh * 60 + Number(range[3] ?? 0);
    intent.endMinutes = eh * 60 + Number(range[6] ?? 0);
    intent.exactStart = true;
    if (intent.endMinutes > intent.startMinutes) intent.durationHours = (intent.endMinutes - intent.startMinutes) / 60;
    cut(new RegExp(range[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } else {
    const single = s.match(new RegExp(`\\b(at|from|after|before|by|around|until|till)?\\s*${T}`, "g")) ?? [];
    for (const raw of single) {
      const r = raw.match(new RegExp(`\\b(at|from|after|before|by|around|until|till)?\\s*${T}`))!;
      const word = r[1];
      if (!word && !r[3] && !r[4]) continue; // a bare number is not a time
      if (/^\s*noon/.test(raw)) continue;
      const h = Number(r[2]);
      if (h > 24 || Number(r[3] ?? 0) >= 60) continue;
      const mer = r[4] === "noon" ? "pm" : r[4];
      const hour = mer ? to24(h, mer) : guessHour(h);
      const min = hour * 60 + Number(r[3] ?? 0);
      if (word === "before" || word === "by" || word === "until" || word === "till") intent.endMinutes = min;
      else {
        intent.startMinutes = min;
        intent.exactStart = word !== "after";
      }
      cut(new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      break;
    }
    if (intent.startMinutes === undefined && /\bnoon\b/.test(s)) {
      intent.startMinutes = 12 * 60;
      intent.exactStart = true;
    }
  }
  if (intent.startMinutes !== undefined && intent.partOfDay) delete intent.partOfDay;

  intent.query = s
    .replace(/\b(morning|afternoon|evening|night|noon|after lunch|post lunch)\b/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !FILLER.has(w) && !/^\d+$/.test(w) && weekdayIndex(w) < 0 && !MONTHS.includes(w.slice(0, 3)))
    .join(" ");
  return intent;
}

/** Fold a follow-up into the previous turn's intent: the newer message wins on anything it states. */
export function mergeIntent(prev: Intent | null, next: Intent, nextMatchesSomething: boolean): Intent {
  if (!prev || next.kind !== "find") return next;
  const merged: Intent = { ...prev, kind: "find" };
  merged.query = nextMatchesSomething ? next.query : prev.query;
  for (const k of ["fromDate", "toDate", "dateLabel", "durationHours", "purposeType", "category"] as const) {
    if (next[k] !== undefined) (merged as Record<string, unknown>)[k] = next[k];
  }
  // Time-of-day fields travel together.
  if (next.partOfDay || next.startMinutes !== undefined || next.endMinutes !== undefined) {
    merged.partOfDay = next.partOfDay;
    merged.startMinutes = next.startMinutes;
    merged.endMinutes = next.endMinutes;
    merged.exactStart = next.exactStart;
  }
  if (next.durationHours !== undefined && next.startMinutes === undefined && merged.exactStart && merged.startMinutes !== undefined) {
    merged.endMinutes = merged.startMinutes + next.durationHours * 60;
  }
  return merged;
}

/** A human summary of what the parser understood (shown as the first step). */
export function describeIntent(i: Intent) {
  const bits: string[] = [];
  if (i.query) bits.push(`“${i.query}”`);
  if (i.dateLabel) bits.push(i.dateLabel);
  if (i.partOfDay) bits.push(i.partOfDay);
  if (i.startMinutes !== undefined && i.endMinutes !== undefined) bits.push(`${fmtMinutes(i.startMinutes)}–${fmtMinutes(i.endMinutes)}`);
  else if (i.startMinutes !== undefined) bits.push(`${i.exactStart ? "at" : "after"} ${fmtMinutes(i.startMinutes)}`);
  else if (i.endMinutes !== undefined) bits.push(`before ${fmtMinutes(i.endMinutes)}`);
  if (i.durationHours) bits.push(`${i.durationHours} h`);
  return bits.join(" · ") || "your request";
}
