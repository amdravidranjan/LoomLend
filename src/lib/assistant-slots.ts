// Free-slot finder: concrete, requestable slots for one resource. Pure (no DB) so it can be unit-tested.
// Respects opening days/hours, the session-length limit, the booking horizon, slots already held by
// someone else, and the requester's fair-share weekly cap on this resource.
import type { Booking, Resource } from "@/db/schema";
import { BOOKING_HORIZON_DAYS } from "./catalog";
import { overlaps, parseList, weeklyHours } from "./rules";
import { DAY, HOUR } from "./time";
import { PARTS_OF_DAY, addDays, dayStartOf, weekdayOf, type PartOfDay } from "./assistant-parse";

export type Interval = { start: number; end: number };

export type SlotQuery = {
  fromDate: string; // YYYY-MM-DD campus
  toDate: string;
  durationHours: number;
  partOfDay?: PartOfDay;
  /** Minutes after campus midnight. */
  earliestStart?: number;
  latestEnd?: number;
  /** Only the slot starting exactly at earliestStart. */
  exactStart?: boolean;
};

export type FoundSlot = Interval & { contested: boolean };

export type SlotSearch = {
  slots: FoundSlot[];
  durationHours: number;
  durationClamped: boolean;
  /** Candidate slots that fit every rule but are already held by someone else (requesting one joins the waiting list). */
  takenSlots: Interval[];
  /** The approved bookings that block the requested window. */
  heldWindows: Interval[];
  capBlocked: number;
  capRemainingHours: number;
  closedDays: string[];
  beyondHorizon: boolean;
  inPast: boolean;
};

const STEP = 30 * 60_000;

export function findSlots(
  resource: Pick<Resource, "id" | "openHour" | "closeHour" | "openDays" | "maxHours" | "weeklyHourCap">,
  q: SlotQuery,
  ctx: { now: number; holders: Interval[]; pending: Interval[]; userBookings: Booking[]; limit?: number; perDay?: number },
): SlotSearch {
  const limit = ctx.limit ?? 3;
  const perDay = ctx.perDay ?? 2;
  const want = Math.max(0.5, q.durationHours || 1);
  const dur = Math.min(want, resource.maxHours);
  const days = parseList<number>(resource.openDays);
  const horizonEnd = ctx.now + BOOKING_HORIZON_DAYS * DAY;
  const out: SlotSearch = {
    slots: [],
    durationHours: dur,
    durationClamped: dur < want,
    takenSlots: [],
    heldWindows: [],
    capBlocked: 0,
    capRemainingHours: Infinity,
    closedDays: [],
    beyondHorizon: false,
    inPast: false,
  };

  const candidates: FoundSlot[] = [];
  let day = q.fromDate;
  for (let i = 0; i < 21 && day <= q.toDate; i++, day = addDays(day, 1)) {
    const base = dayStartOf(day);
    if (base + DAY <= ctx.now) {
      out.inPast = true;
      continue;
    }
    if (base >= horizonEnd) {
      out.beyondHorizon = true;
      break;
    }
    if (!days.includes(weekdayOf(day))) {
      out.closedDays.push(day);
      continue;
    }
    let lo = resource.openHour * 60;
    let hi = resource.closeHour * 60;
    if (q.partOfDay) {
      const [a, b] = PARTS_OF_DAY[q.partOfDay];
      lo = Math.max(lo, a * 60);
      hi = Math.min(hi, b * 60);
    }
    if (q.earliestStart !== undefined) lo = Math.max(lo, q.earliestStart);
    if (q.latestEnd !== undefined) hi = Math.min(hi, q.latestEnd);
    // A part-of-day window shorter than the session still lets the session run past it, up to closing.
    if (q.partOfDay && hi - lo < dur * 60) hi = Math.min(resource.closeHour * 60, lo + dur * 60);

    const firstStart = base + lo * 60_000;
    const lastStart = q.exactStart ? firstStart : base + hi * 60_000 - dur * HOUR;
    const close = base + resource.closeHour * HOUR;
    for (let start = firstStart; start <= lastStart; start += STEP) {
      const end = start + dur * HOUR;
      if (end > close) break;
      if (start < ctx.now) {
        if (q.exactStart) out.inPast = true;
        continue;
      }
      if (start >= horizonEnd) {
        out.beyondHorizon = true;
        break;
      }
      const slot = { start, end };
      if (ctx.holders.some((h) => overlaps(h, slot))) {
        out.takenSlots.push(slot);
        continue;
      }
      const used = weeklyHours(ctx.userBookings, resource.id, start);
      out.capRemainingHours = Math.min(out.capRemainingHours, Math.max(0, resource.weeklyHourCap - used));
      if (used + dur > resource.weeklyHourCap) {
        out.capBlocked++;
        continue;
      }
      candidates.push({ ...slot, contested: ctx.pending.some((p) => overlaps(p, slot)) });
    }
  }

  // Prefer uncontested slots, then earliest; never offer two overlapping slots; spread across days.
  const ranked = [...candidates].sort((a, b) => Number(a.contested) - Number(b.contested) || a.start - b.start);
  const perDayCount = new Map<number, number>();
  for (const c of ranked) {
    if (out.slots.length >= limit) break;
    const dk = Math.floor((c.start + 5.5 * HOUR) / DAY);
    if ((perDayCount.get(dk) ?? 0) >= perDay) continue;
    if (out.slots.some((s) => overlaps(s, c) || Math.abs(s.start - c.start) < dur * HOUR)) continue;
    out.slots.push(c);
    perDayCount.set(dk, (perDayCount.get(dk) ?? 0) + 1);
  }
  out.slots.sort((a, b) => a.start - b.start);
  if (out.capRemainingHours === Infinity) out.capRemainingHours = resource.weeklyHourCap;
  // Merge adjacent taken candidates into distinct held windows for the waiting-list offer.
  out.heldWindows = ctx.holders
    .filter((h) => out.takenSlots.some((t) => overlaps(t, h)))
    .map((h) => ({ start: h.start, end: h.end }))
    .sort((a, b) => a.start - b.start);
  return out;
}
