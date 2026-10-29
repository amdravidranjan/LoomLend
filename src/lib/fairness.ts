import "server-only";
// Fairness ledger: public inequality metrics per resource and campus-wide, plus a personal fair-share view.
import { and, gte, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AllocationRound, Booking, Resource, User } from "@/db/schema";
import { weeklyHours } from "./rules";
import { GINI_ALERT, gini, lorenz, median, topShare } from "./inequality";
import { parseLog } from "./allocation";
import { DAY, HOUR } from "./time";
import type { Outcome } from "./lottery";

export const WINDOW_DAYS = 30;
const HELD: Booking["status"][] = ["approved", "checked_out", "returned", "closed"];
const WAIT_START = new Set(["booking.waitlisted", "round.lost"]);
const WAIT_END = new Set(["booking.promoted", "booking.approved", "booking.cancelled", "booking.rejected"]);

export type ResourceLedger = {
  resource: Resource;
  people: number; // people who asked for or held it in the window
  hours: number;
  gini: number;
  lorenz: { p: number; share: number }[];
  top10: number;
  firstTry: { rate: number | null; n: number };
  medianWaitHours: number | null;
  waitSamples: number;
  creditsOutstanding: number;
  openRounds: AllocationRound[];
  drawnRounds: AllocationRound[];
  flagged: boolean;
};

export type PersonalDraw = { round: AllocationRound; resourceName: string; rank: number; entrants: number; outcome: Outcome; overridden: boolean };

export type Ledger = {
  since: number;
  resources: ResourceLedger[];
  campus: { gini: number; lorenz: { p: number; share: number }[]; top10: number; hours: number; people: number; roundsDrawn: number; creditsOutstanding: number; flagged: number };
  personal: null | {
    usage: { resource: Resource; hours7d: number; cap: number; credits: number }[];
    draws: PersonalDraw[];
    totalCredits: number;
  };
};

export async function fairnessLedger(now: number, viewer: User | null): Promise<Ledger> {
  const since = now - WINDOW_DAYS * DAY;
  const resources = (await db.select().from(schema.resources)).filter((r) => r.status !== "retired");
  const bookings = await db.select().from(schema.bookings).where(gte(schema.bookings.end, since - 7 * DAY));
  const rounds = await db.select().from(schema.allocationRounds);
  const credits = await db.select().from(schema.fairnessCredits);
  const audits = bookings.length
    ? await db
        .select({ bookingId: schema.auditLog.bookingId, action: schema.auditLog.action, createdAt: schema.auditLog.createdAt })
        .from(schema.auditLog)
        .where(and(inArray(schema.auditLog.action, [...WAIT_START, ...WAIT_END]), gte(schema.auditLog.createdAt, since - 7 * DAY)))
    : [];
  const auditsBy = new Map<string, { action: string; createdAt: number }[]>();
  for (const a of audits) if (a.bookingId) auditsBy.set(a.bookingId, [...(auditsBy.get(a.bookingId) ?? []), a]);

  const campusHours = new Map<string, number>();
  const out: ResourceLedger[] = [];
  for (const r of resources) {
    const mine = bookings.filter((b) => b.resourceId === r.id);
    const inWindow = mine.filter((b) => b.start >= since || b.createdAt >= since);
    const hoursBy = new Map<string, number>();
    for (const b of inWindow) {
      if (!hoursBy.has(b.userId)) hoursBy.set(b.userId, 0); // asked but got nothing still counts as a person with 0 h
      if (HELD.includes(b.status) && b.start >= since) hoursBy.set(b.userId, hoursBy.get(b.userId)! + (b.end - b.start) / HOUR);
    }
    for (const [u, h] of hoursBy) campusHours.set(u, (campusHours.get(u) ?? 0) + h);
    const values = [...hoursBy.values()];

    // First-try success: each person's first request in the window that has been decided.
    const firstByUser = new Map<string, Booking>();
    for (const b of [...inWindow].sort((a, c) => a.createdAt - c.createdAt)) {
      if (b.createdAt < since || firstByUser.has(b.userId)) continue;
      if (b.status === "cancelled" || (b.status === "pending" && b.end > now)) continue;
      firstByUser.set(b.userId, b);
    }
    const firsts = [...firstByUser.values()];
    const firstOk = firsts.filter((b) => HELD.includes(b.status)).length;

    // Waiting time: from going on the waiting list to leaving it (or now / the slot start if still waiting).
    const waits: number[] = [];
    for (const b of inWindow) {
      const ev = (auditsBy.get(b.id) ?? []).sort((a, c) => a.createdAt - c.createdAt);
      const startEv = ev.find((e) => WAIT_START.has(e.action));
      if (!startEv) continue;
      const endEv = ev.find((e) => WAIT_END.has(e.action) && e.createdAt >= startEv.createdAt);
      const end = endEv ? endEv.createdAt : b.status === "waitlisted" ? Math.min(now, b.start) : null;
      if (end !== null && end >= startEv.createdAt) waits.push((end - startEv.createdAt) / HOUR);
    }

    const g = gini(values);
    const rr = rounds.filter((x) => x.resourceId === r.id).sort((a, c) => c.dayStart - a.dayStart);
    out.push({
      resource: r,
      people: values.length,
      hours: values.reduce((s, v) => s + v, 0),
      gini: g,
      lorenz: lorenz(values),
      top10: topShare(values, 0.1),
      firstTry: { rate: firsts.length ? firstOk / firsts.length : null, n: firsts.length },
      medianWaitHours: median(waits),
      waitSamples: waits.length,
      creditsOutstanding: credits.filter((c) => c.resourceId === r.id).reduce((s, c) => s + c.credits, 0),
      openRounds: rr.filter((x) => x.status === "open"),
      drawnRounds: rr.filter((x) => x.status === "drawn"),
      flagged: g > GINI_ALERT && values.length >= 3,
    });
  }
  out.sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.gini - a.gini || b.hours - a.hours);

  const campusValues = [...campusHours.values()];
  const campus = {
    gini: gini(campusValues),
    lorenz: lorenz(campusValues),
    top10: topShare(campusValues, 0.1),
    hours: campusValues.reduce((s, v) => s + v, 0),
    people: campusValues.length,
    roundsDrawn: rounds.filter((x) => x.status === "drawn" && (x.drawnAt ?? 0) >= since).length,
    creditsOutstanding: credits.reduce((s, c) => s + c.credits, 0),
    flagged: out.filter((x) => x.flagged).length,
  };

  let personal: Ledger["personal"] = null;
  if (viewer) {
    const myBookings = await db.select().from(schema.bookings).where(inArray(schema.bookings.userId, [viewer.id]));
    const myIds = new Set(myBookings.map((b) => b.id));
    const myCredits = credits.filter((c) => c.userId === viewer.id);
    const touched = new Set([...myBookings.filter((b) => b.end >= since).map((b) => b.resourceId), ...myCredits.filter((c) => c.credits > 0).map((c) => c.resourceId)]);
    const usage = resources
      .filter((r) => touched.has(r.id))
      .map((r) => ({ resource: r, hours7d: weeklyHours(myBookings, r.id, now), cap: r.weeklyHourCap, credits: myCredits.find((c) => c.resourceId === r.id)?.credits ?? 0 }))
      .sort((a, b) => b.hours7d / b.cap - a.hours7d / a.cap);
    const draws: PersonalDraw[] = [];
    for (const round of rounds.filter((x) => x.status === "drawn").sort((a, b) => b.dayStart - a.dayStart)) {
      const log = parseLog(round);
      if (!log) continue;
      for (const e of log.entries.filter((x) => myIds.has(x.bookingId))) {
        draws.push({
          round,
          resourceName: resources.find((r) => r.id === round.resourceId)?.name ?? "Resource",
          rank: e.rank,
          entrants: log.entries.length,
          outcome: e.outcome,
          overridden: log.overrides.some((o) => o.bookingId === e.bookingId),
        });
      }
    }
    personal = { usage, draws, totalCredits: myCredits.reduce((s, c) => s + c.credits, 0) };
  }

  return { since, resources: out, campus, personal };
}
