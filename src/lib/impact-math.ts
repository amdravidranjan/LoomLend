// Impact maths for the principal's dashboard. Pure (no DB) so the numbers are unit-tested.
import type { Booking, Resource } from "@/db/schema";
import { DAY, HOUR, campusDayAt, campusParts } from "./time";

export type ImpactResource = Pick<
  Resource,
  "id" | "name" | "emoji" | "department" | "category" | "openHour" | "closeHour" | "openDays" | "status" | "marketRatePerHour" | "purchaseValue" | "createdAt"
>;
export type ImpactBooking = Pick<Booking, "id" | "resourceId" | "userId" | "start" | "end" | "status" | "decisionReason" | "returnAt">;
export type ImpactIncident = { id: string; resourceId: string; createdAt: number };
export type ImpactUser = { id: string; department: string };

/** Years over which equipment is amortised for cost-per-use. */
export const ASSET_LIFE_YEARS = 5;
/** Minutes after the slot end that still count as an on-time return. */
export const RETURN_GRACE_MIN = 10;

export const NO_SHOW_PREFIX = "No-show";

/** A booking that actually happened (the item was picked up). */
export function wasUsed(b: Pick<Booking, "status" | "decisionReason">) {
  if (b.status === "closed") return !b.decisionReason?.startsWith(NO_SHOW_PREFIX);
  return b.status === "checked_out" || b.status === "returned";
}

export type UnmetKind = "waitlist" | "taken" | "cap";
/** Demand that LoomLend had to turn away for lack of capacity (not policy rejections like banned materials). */
export function unmetKind(b: Pick<Booking, "status" | "decisionReason">): UnmetKind | null {
  if (b.status === "waitlisted") return "waitlist";
  if (b.status !== "rejected") return null;
  const why = (b.decisionReason ?? "").toLowerCase();
  if (/fair-share|weekly cap|\bcap\b/.test(why)) return "cap";
  if (/taken|overlap|fully booked|no capacity|clash/.test(why)) return "taken";
  return null;
}

function clip(start: number, end: number, from: number, to: number) {
  return Math.max(0, Math.min(end, to) - Math.max(start, from)) / HOUR;
}

/** Hours a resource was open for booking in [from, to). */
export function openHours(r: Pick<ImpactResource, "openHour" | "closeHour" | "openDays" | "createdAt" | "status">, from: number, to: number) {
  let days: number[];
  try {
    days = JSON.parse(r.openDays);
  } catch {
    days = [];
  }
  if (r.status !== "active") return 0;
  let total = 0;
  const start = Math.max(from, r.createdAt);
  for (let t = campusDayAt(start, 0); t < to; t += DAY) {
    const noon = t + 12 * HOUR;
    if (!days.includes(campusParts(noon).weekday)) continue;
    total += clip(campusDayAt(noon, r.openHour), campusDayAt(noon, r.closeHour), start, to);
  }
  return total;
}

export type ResourceImpact = {
  id: string;
  name: string;
  emoji: string;
  department: string;
  status: string;
  openHours: number;
  bookedHours: number;
  utilisation: number; // 0..1
  idleHours: number;
  crossDeptHours: number;
  uses: number;
  people: number;
  saved: number; // ₹
  marketRatePerHour: number;
  purchaseValue: number;
  costPerUse: number | null; // amortised ₹ per use in the period
  rentPerUse: number | null; // ₹ to rent the same hours outside, per use
  unmetHours: number;
  unmetRequests: number;
  unmetByKind: Record<UnmetKind, number>;
  onTimeRate: number | null;
  incidents: number;
  recommendation: Recommendation | null;
};

export type Recommendation = {
  kind: "second_unit" | "extend_hours";
  monthlyUnmetHours: number;
  monthlyValue: number; // ₹ of rental the turned-away hours represent per month
  paybackMonths: number | null;
  text: string;
};

export type Totals = {
  bookedHours: number;
  openHours: number;
  utilisation: number;
  crossDeptHours: number;
  crossDeptShare: number;
  saved: number;
  people: number;
  uses: number;
  unmetHours: number;
  onTimeRate: number | null;
  incidentsPer100: number | null;
};

export type ImpactReport = {
  from: number;
  to: number;
  days: number;
  totals: Totals;
  previous: Totals | null;
  trend: (Totals & { from: number; to: number })[];
  resources: ResourceImpact[];
  matrix: { borrowerDepts: string[]; ownerDepts: string[]; hours: number[][] };
  heatmap: { days: number[]; hours: number[]; demand: number[][]; max: number };
};

const HEAT_HOURS = Array.from({ length: 14 }, (_, i) => 8 + i); // 8:00–21:00
const HEAT_DAYS = [1, 2, 3, 4, 5, 6, 0];

export function recommend(r: { name: string; utilisation: number; purchaseValue: number; marketRatePerHour: number }, unmetHours: number, days: number): Recommendation | null {
  const monthly = (unmetHours / days) * 30;
  if (monthly < 6 || r.utilisation < 0.3) return null;
  const monthlyValue = Math.round(monthly * r.marketRatePerHour);
  if (r.purchaseValue > 0 && monthlyValue > 0) {
    const payback = r.purchaseValue / monthlyValue;
    return {
      kind: "second_unit",
      monthlyUnmetHours: monthly,
      monthlyValue,
      paybackMonths: payback,
      text: `About ${Math.round(monthly)} h a month are turned away. A second unit would serve them and save roughly ₹${monthlyValue.toLocaleString("en-IN")} a month in rental, paying for itself in about ${payback < 1 ? "under a month" : `${Math.round(payback)} months`}.`,
    };
  }
  return {
    kind: "extend_hours",
    monthlyUnmetHours: monthly,
    monthlyValue,
    paybackMonths: null,
    text: `About ${Math.round(monthly)} h a month are turned away. Extending opening hours or adding a similar space would absorb them.`,
  };
}

function totalsFor(resources: ImpactResource[], bookings: ImpactBooking[], incidents: ImpactIncident[], deptOf: Map<string, string>, from: number, to: number): Totals {
  const rById = new Map(resources.map((r) => [r.id, r]));
  let booked = 0,
    cross = 0,
    saved = 0,
    unmet = 0,
    uses = 0,
    returned = 0,
    onTime = 0;
  const people = new Set<string>();
  for (const b of bookings) {
    const r = rById.get(b.resourceId);
    if (!r || b.start >= to || b.end <= from) continue;
    if (wasUsed(b)) {
      const h = clip(b.start, b.end, from, to);
      booked += h;
      uses++;
      people.add(b.userId);
      saved += h * r.marketRatePerHour;
      if ((deptOf.get(b.userId) ?? r.department) !== r.department) cross += h;
      if (b.returnAt) {
        returned++;
        if (b.returnAt <= b.end + RETURN_GRACE_MIN * 60_000) onTime++;
      }
    } else if (unmetKind(b)) {
      unmet += (b.end - b.start) / HOUR;
    }
  }
  const open = resources.reduce((s, r) => s + openHours(r, from, to), 0);
  const inc = incidents.filter((i) => i.createdAt >= from && i.createdAt < to && rById.has(i.resourceId)).length;
  return {
    bookedHours: booked,
    openHours: open,
    utilisation: open ? booked / open : 0,
    crossDeptHours: cross,
    crossDeptShare: booked ? cross / booked : 0,
    saved: Math.round(saved),
    people: people.size,
    uses,
    unmetHours: unmet,
    onTimeRate: returned ? onTime / returned : null,
    incidentsPer100: uses ? (inc / uses) * 100 : null,
  };
}

export function computeImpact(input: {
  resources: ImpactResource[];
  bookings: ImpactBooking[];
  incidents: ImpactIncident[];
  users: ImpactUser[];
  from: number;
  to: number;
}): ImpactReport {
  const { resources, bookings, incidents, users, from, to } = input;
  const days = Math.max(1, Math.round((to - from) / DAY));
  const deptOf = new Map(users.map((u) => [u.id, u.department]));
  // Only count demand that has already happened (future waitlist entries are not yet "unmet").
  const past = bookings.filter((b) => b.start < to);

  const perResource: ResourceImpact[] = resources.map((r) => {
    const mine = past.filter((b) => b.resourceId === r.id && b.start < to && b.end > from);
    const t = totalsFor([r], mine, incidents, deptOf, from, to);
    const unmetByKind: Record<UnmetKind, number> = { waitlist: 0, taken: 0, cap: 0 };
    let unmetRequests = 0;
    for (const b of mine) {
      const k = unmetKind(b);
      if (k) {
        unmetByKind[k] += (b.end - b.start) / HOUR;
        unmetRequests++;
      }
    }
    const capital = r.purchaseValue ? (r.purchaseValue / (ASSET_LIFE_YEARS * 365)) * days : 0;
    const res: ResourceImpact = {
      id: r.id,
      name: r.name,
      emoji: r.emoji,
      department: r.department,
      status: r.status,
      openHours: t.openHours,
      bookedHours: t.bookedHours,
      utilisation: t.utilisation,
      idleHours: Math.max(0, t.openHours - t.bookedHours),
      crossDeptHours: t.crossDeptHours,
      uses: t.uses,
      people: t.people,
      saved: t.saved,
      marketRatePerHour: r.marketRatePerHour,
      purchaseValue: r.purchaseValue,
      costPerUse: r.purchaseValue && t.uses ? Math.round(capital / t.uses) : null,
      rentPerUse: t.uses && r.marketRatePerHour ? Math.round((t.bookedHours / t.uses) * r.marketRatePerHour) : null,
      unmetHours: t.unmetHours,
      unmetRequests,
      unmetByKind,
      onTimeRate: t.onTimeRate,
      incidents: incidents.filter((i) => i.resourceId === r.id && i.createdAt >= from && i.createdAt < to).length,
      recommendation: null,
    };
    res.recommendation = recommend(res, t.unmetHours, days);
    return res;
  });

  const totals = totalsFor(resources, past, incidents, deptOf, from, to);
  const len = to - from;
  // Compare with the previous period only when it has enough history to be meaningful.
  const hadEarlier = bookings.filter((b) => b.start < from && b.start >= from - len && wasUsed(b)).length >= 5;
  const previous = hadEarlier ? totalsFor(resources, bookings, incidents, deptOf, from - len, from) : null;

  // Sparkline buckets: daily for a week, otherwise whole weeks ending now (a partial week would fake a dip).
  const size = days <= 7 ? DAY : 7 * DAY;
  const buckets = Math.max(1, days <= 7 ? days : Math.floor(days / 7));
  const trend = Array.from({ length: buckets }, (_, i) => {
    const bTo = to - (buckets - 1 - i) * size;
    const bFrom = bTo - size;
    return { ...totalsFor(resources, past, incidents, deptOf, bFrom, bTo), from: bFrom, to: bTo };
  });

  // Who borrows from whom (hours), rows = borrower department, columns = owning department.
  const ownerDepts = [...new Set(resources.map((r) => r.department))].sort();
  const flows = new Map<string, number>();
  const borrowerSet = new Set<string>();
  const rDept = new Map(resources.map((r) => [r.id, r.department]));
  for (const b of past) {
    if (!wasUsed(b) || b.end <= from || b.start >= to) continue;
    const owner = rDept.get(b.resourceId);
    if (!owner) continue;
    const borrower = deptOf.get(b.userId) ?? "Other";
    borrowerSet.add(borrower);
    const k = `${borrower}|${owner}`;
    flows.set(k, (flows.get(k) ?? 0) + clip(b.start, b.end, from, to));
  }
  const rowTotal = (d: string) => ownerDepts.reduce((s, o) => s + (flows.get(`${d}|${o}`) ?? 0), 0);
  const borrowerDepts = [...borrowerSet].sort((a, b) => rowTotal(b) - rowTotal(a));
  const matrix = { borrowerDepts, ownerDepts, hours: borrowerDepts.map((d) => ownerDepts.map((o) => flows.get(`${d}|${o}`) ?? 0)) };

  // Demand heatmap: every requested hour (used, waiting, turned away), by weekday × hour of day.
  const demand = HEAT_DAYS.map(() => HEAT_HOURS.map(() => 0));
  for (const b of past) {
    if (b.end <= from || b.start >= to || b.status === "cancelled") continue;
    if (!wasUsed(b) && !unmetKind(b) && b.status !== "pending" && b.status !== "approved") continue;
    for (let t = b.start; t < b.end; t += HOUR) {
      const p = campusParts(t);
      const di = HEAT_DAYS.indexOf(p.weekday);
      const hi = HEAT_HOURS.indexOf(p.hour);
      if (di >= 0 && hi >= 0) demand[di][hi] += Math.min(1, (b.end - t) / HOUR);
    }
  }
  const max = Math.max(0, ...demand.flat());

  return {
    from,
    to,
    days,
    totals,
    previous,
    trend,
    resources: perResource.sort((a, b) => b.utilisation - a.utilisation),
    matrix,
    heatmap: { days: HEAT_DAYS, hours: HEAT_HOURS, demand, max },
  };
}

// ------------------------------------------------------------------ formatting (Indian grouping)

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
export const fmtINR = (n: number) => inr.format(Math.round(n));
export const fmtNum = (n: number) => num.format(Math.round(n));
export const fmtPct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
export const fmtHours = (h: number) => `${num.format(Math.round(h))} h`;
