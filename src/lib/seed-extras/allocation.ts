import "server-only";
// Allocation rounds and fairness credits (owned by the allocation agent).
//  - Laser cutter and 3D printer use fair-draw rounds.
//  - One drawn round in the past per resource, with revealed seed and results that verify in the browser.
//  - One OPEN laser round ~2 days out with three entrants, so judges can press "Run draw now (demo)".
//    The base seed's two competing laser requests (d8a2f4 Divya, b5e1c7 Farhan) become entries in it.
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Booking, Resource } from "@/db/schema";
import { audit } from "../audit";
import { priorityScore, roundTiming, weeklyHours } from "../rules";
import { MAX_CREDITS, commitmentOf, newSeed, runDraw, type DrawLog, type DrawPerson } from "../lottery";
import { DAY, HOUR, campusDayAt, campusParts, fmtDateTime, fmtDay, fmtTime } from "../time";

const B = schema.bookings;
const ROUND_RESOURCES = ["r-laser", "r-printer"];

function weekdayDayStart(offset: number, now: number, days = [1, 2, 3, 4, 5]) {
  let t = now + offset * DAY;
  const step = offset < 0 ? -DAY : DAY;
  while (!days.includes(campusParts(t).weekday)) t += step;
  return campusDayAt(t, 0);
}

const credits = new Map<string, number>();
async function addCredit(userId: string, resourceId: string, at: number) {
  const k = `${userId}|${resourceId}`;
  const v = Math.min(MAX_CREDITS, (credits.get(k) ?? 0) + 1);
  credits.set(k, v);
  const row = await db.query.fairnessCredits.findFirst({ where: and(eq(schema.fairnessCredits.userId, userId), eq(schema.fairnessCredits.resourceId, resourceId)) });
  if (row) await db.update(schema.fairnessCredits).set({ credits: v, updatedAt: at }).where(eq(schema.fairnessCredits.id, row.id));
  else await db.insert(schema.fairnessCredits).values({ id: crypto.randomUUID(), userId, resourceId, credits: v, updatedAt: at });
  return v;
}
const creditOf = (userId: string, resourceId: string) => credits.get(`${userId}|${resourceId}`) ?? 0;

type Entry = { id: string; userId: string; from: number; to: number; purposeType: Booking["purposeType"]; purpose: string };

async function scoreFor(userId: string, resourceId: string, purposeType: Booking["purposeType"], at: number) {
  const user = (await db.query.users.findFirst({ where: eq(schema.users.id, userId) }))!;
  const history = (await db.select().from(B).where(eq(B.userId, userId))).filter((b) => b.createdAt < at);
  return priorityScore({ purposeType, createdAt: at, resourceId }, user, history, at, creditOf(userId, resourceId));
}

/** A complete round in the past: entries, commitment, reveal, results, confirmations, credits. */
/**
 * A past campus day (searching back from `fromOffset`) with no held booking during the entries' hours, so the
 * seeded draw is decided by the lottery, not by synthetic history that already occupies the day.
 */
async function clearPastDay(resource: Resource, fromOffset: number, entries: Entry[], now: number, days?: number[]) {
  const held = await db.select().from(B).where(and(eq(B.resourceId, resource.id), inArray(B.status, ["approved", "checked_out", "returned", "closed"])));
  const from = Math.min(...entries.map((e) => e.from));
  const to = Math.max(...entries.map((e) => e.to));
  let fallback = 0;
  for (let k = 0; k < 10; k++) {
    const dayStart = weekdayDayStart(fromOffset - k, now, days);
    if (!fallback) fallback = dayStart;
    if (!held.some((b) => b.start < dayStart + to * HOUR && b.end > dayStart + from * HOUR)) return dayStart;
  }
  return fallback;
}

async function seedDrawnRound(resource: Resource, dayStart: number, entries: Entry[], now: number) {
  const { closesAt } = roundTiming(resource, dayStart + 12 * HOUR);
  const roundId = crypto.randomUUID();
  const seed = newSeed();
  const commitment = await commitmentOf(seed);
  const openedAt = closesAt - 2 * DAY;
  const drawnAt = closesAt + 60_000;
  const day = fmtDay(dayStart + 12 * HOUR);
  await db.insert(schema.allocationRounds).values({ id: roundId, resourceId: resource.id, dayStart, closesAt, status: "open", seedCommitment: commitment, seed, createdAt: openedAt });
  await audit({ actorId: null, action: "round.opened", entityType: "resource", entityId: resource.id, details: { roundId, day, commitment }, at: openedAt });

  for (const [i, e] of entries.entries()) {
    const at = openedAt + (i + 1) * 3 * HOUR;
    const { score, factors } = await scoreFor(e.userId, resource.id, e.purposeType, at);
    await db.insert(B).values({
      id: e.id,
      resourceId: resource.id,
      userId: e.userId,
      start: dayStart + e.from * HOUR,
      end: dayStart + e.to * HOUR,
      purpose: e.purpose,
      purposeType: e.purposeType,
      status: "pending",
      priorityScore: score,
      priorityBreakdown: JSON.stringify(factors),
      eligibilitySnapshot: JSON.stringify({ eligible: true, checks: [], needsSupervision: resource.supervisionRequired }),
      roundId,
      createdAt: at,
    });
    await audit({ actorId: e.userId, action: "booking.requested", entityType: "booking", entityId: e.id, details: { resource: resource.name, priority: score, roundId }, at });
    await audit({ actorId: null, action: "round.entered", entityType: "booking", entityId: e.id, details: { roundId, weightScore: score }, at });
  }

  const rows = (await db.select().from(B).where(eq(B.roundId, roundId))).sort((a, b) => a.createdAt - b.createdAt);
  const personOf = new Map<string, number>();
  for (const b of rows) if (!personOf.has(b.userId)) personOf.set(b.userId, personOf.size + 1);
  const people: DrawPerson[] = [];
  for (const [userId, person] of personOf) {
    const others = (await db.select().from(B).where(eq(B.userId, userId))).filter((b) => b.roundId !== roundId && b.createdAt < drawnAt);
    people.push({ person, capHours: Math.max(0, resource.weeklyHourCap - weeklyHours(others, resource.id, dayStart + 12 * HOUR)) });
  }
  const blocked = (await db.select().from(B).where(and(eq(B.resourceId, resource.id), inArray(B.status, ["approved", "checked_out", "returned", "closed"]))))
    .filter((b) => b.roundId !== roundId && b.start < dayStart + DAY && b.end > dayStart && b.createdAt < drawnAt)
    .map((b) => ({ start: b.start, end: b.end }));
  const results = await runDraw(
    seed,
    rows.map((b) => ({ bookingId: b.id, person: personOf.get(b.userId)!, start: b.start, end: b.end, score: b.priorityScore })),
    blocked,
    people,
  );
  const log: DrawLog = {
    version: 1,
    algorithm: "Efraimidis–Spirakis weighted random order, u from HMAC-SHA256(seed, booking id), greedy non-overlapping allocation with fair-share caps",
    weightFormula: "w = max(score, 10) / 10",
    resourceId: resource.id,
    dayStart,
    closesAt,
    drawnAt,
    early: false,
    commitment,
    blocked,
    people,
    entries: results,
    overrides: [],
  };
  await db.update(schema.allocationRounds).set({ status: "drawn", drawnAt, results: JSON.stringify(log) }).where(eq(schema.allocationRounds.id, roundId));

  const link = `/fairness/rounds/${roundId}`;
  for (const e of results) {
    const b = rows.find((x) => x.id === e.bookingId)!;
    const keyText = `your key was ${e.key.toFixed(4)} (weight ${e.weight.toFixed(1)}), drawn ${e.rank} of ${results.length}`;
    if (e.outcome === "won") {
      credits.set(`${b.userId}|${resource.id}`, 0);
      await db
        .update(schema.fairnessCredits)
        .set({ credits: 0, updatedAt: drawnAt })
        .where(and(eq(schema.fairnessCredits.userId, b.userId), eq(schema.fairnessCredits.resourceId, resource.id)));
      const done = b.end < now;
      await db
        .update(B)
        .set({
          status: done ? "closed" : "approved",
          decisionReason: done ? "Return confirmed. Owner assessed condition: Good." : `Confirmed draw winner for ${day}.`,
          decidedBy: resource.ownerId,
          ...(done
            ? { checkOutAt: b.start + 5 * 60_000, checkOutCondition: "good", returnAt: b.end - 5 * 60_000, returnCondition: "good", returnConfirmedBy: resource.ownerId, checkOutMethod: "staff_manual" as const, returnMethod: "staff_manual" as const }
            : {}),
        })
        .where(eq(B.id, b.id));
      await audit({ actorId: null, action: "round.won", entityType: "booking", entityId: b.id, details: { roundId, rank: e.rank, key: e.key.toFixed(6), weight: e.weight }, at: drawnAt });
      await audit({ actorId: resource.ownerId, action: "booking.approved", entityType: "booking", entityId: b.id, details: { reason: `Confirmed draw winner (${link})` }, at: drawnAt + HOUR });
      if (done) {
        await audit({ actorId: resource.ownerId, action: "booking.checked_out", entityType: "booking", entityId: b.id, details: { condition: "good" }, at: b.start + 5 * 60_000 });
        await audit({ actorId: b.userId, action: "booking.returned", entityType: "booking", entityId: b.id, details: { condition: "good", minutesLate: 0 }, at: b.end - 5 * 60_000 });
        await audit({ actorId: resource.ownerId, action: "booking.return_confirmed", entityType: "booking", entityId: b.id, details: { ownerCondition: "good" }, at: b.end });
      }
    } else {
      const c = await addCredit(b.userId, resource.id, drawnAt);
      const beat = e.beatenBy ? results.find((x) => x.rank === e.beatenBy) : null;
      const cause =
        e.outcome === "overlap" && beat
          ? `The ${fmtTime(beat.start)}–${fmtTime(beat.end)} slot overlapping yours went to the entry drawn ${beat.rank} (key ${beat.key.toFixed(4)}), before your turn.`
          : e.outcome === "cap"
            ? `Taking this slot would have put you over the ${resource.weeklyHourCap} h fair-share cap.`
            : "Your time clashes with a booking that was already approved before the draw.";
      await db
        .update(B)
        .set({
          status: "waitlisted",
          decisionReason: `Not this time. In the draw for ${day} ${keyText}. ${cause} You were on the waiting list but no slot freed up. You earned +1 fairness credit on this resource (now ${c}). Verify: ${link}`,
        })
        .where(eq(B.id, b.id));
      await audit({ actorId: null, action: "round.lost", entityType: "booking", entityId: b.id, details: { roundId, rank: e.rank, key: e.key.toFixed(6), creditsNow: c }, at: drawnAt });
    }
  }
  await audit({
    actorId: null,
    action: "round.drawn",
    entityType: "resource",
    entityId: resource.id,
    details: { roundId, day, entries: results.length, winners: results.filter((r) => r.outcome === "won").length, seed, commitment, closes: fmtDateTime(closesAt) },
    at: drawnAt,
  });
  return roundId;
}

export async function seedAllocation(now: number) {
  credits.clear();
  await db.update(schema.resources).set({ allocationMode: "rounds", roundLeadHours: 24 }).where(inArray(schema.resources.id, ROUND_RESOURCES));
  const laser = (await db.query.resources.findFirst({ where: eq(schema.resources.id, "r-laser") }))!;
  const printer = (await db.query.resources.findFirst({ where: eq(schema.resources.id, "r-printer") }))!;

  // Past draws (already revealed, verifiable immediately).
  const rd1: Entry[] = [
      { id: "rd1-laser-divya", userId: "u-divya", from: 10, to: 12, purposeType: "project", purpose: "Capstone: first set of plywood ribs for the solar dryer frame." },
      { id: "rd1-laser-farhan", userId: "u-farhan", from: 10.5, to: 12.5, purposeType: "personal", purpose: "Cutting an acrylic phone stand I designed in Fusion 360." },
      { id: "rd1-laser-priya", userId: "u-priya", from: 11, to: 13, purposeType: "coursework", purpose: "Laser-cut front panel for the EC6702 weather-station enclosure." },
      { id: "rd1-laser-farhan2", userId: "u-farhan", from: 14, to: 16, purposeType: "project", purpose: "Robotics club: engraving team badges for the inter-college meet." },
  ];
  // Past draws stay outside everyone's current 7-day fair-share window (older than 8 days).
  await seedDrawnRound(laser, await clearPastDay(laser, -18, rd1, now), rd1, now);
  const rd2: Entry[] = [
      { id: "rd2-laser-farhan", userId: "u-farhan", from: 13, to: 15, purposeType: "project", purpose: "Robotics club: cutting chassis plates for the line follower." },
      { id: "rd2-laser-divya", userId: "u-divya", from: 13.5, to: 15.5, purposeType: "project", purpose: "Capstone: second batch of ribs after design change." },
      { id: "rd2-laser-priya", userId: "u-priya", from: 15, to: 17, purposeType: "coursework", purpose: "Re-cutting the enclosure lid with corrected tolerances." },
  ];
  await seedDrawnRound(laser, await clearPastDay(laser, -9, rd2, now), rd2, now);
  const rd3: Entry[] = [
      { id: "rd3-printer-arjun", userId: "u-arjun", from: 9, to: 15, purposeType: "coursework", purpose: "Printing the ME5102 gearbox housing, first attempt." },
      { id: "rd3-printer-priya", userId: "u-priya", from: 10, to: 14, purposeType: "project", purpose: "Printing sensor mounts for the weather station mast." },
      { id: "rd3-printer-divya", userId: "u-divya", from: 13, to: 19, purposeType: "project", purpose: "Printing solar dryer vent louvres in PETG." },
  ];
  await seedDrawnRound(printer, await clearPastDay(printer, -10, rd3, now, [1, 2, 3, 4, 5, 6]), rd3, now);

  // The OPEN laser round: a weekday at least ~2 days out whose entries close at least 18 h from now.
  let dayStart = weekdayDayStart(2, now);
  while (roundTiming(laser, dayStart + 12 * HOUR).closesAt < now + 18 * HOUR) dayStart = weekdayDayStart(Math.round((dayStart - now) / DAY) + 1, now);
  const { closesAt } = roundTiming(laser, dayStart + 12 * HOUR);
  const roundId = crypto.randomUUID();
  const seed = newSeed();
  const commitment = await commitmentOf(seed);
  const openedAt = now - 20 * HOUR;
  await db.insert(schema.allocationRounds).values({ id: roundId, resourceId: laser.id, dayStart, closesAt, status: "open", seedCommitment: commitment, seed, createdAt: openedAt });
  await audit({ actorId: null, action: "round.opened", entityType: "resource", entityId: laser.id, details: { roundId, day: fmtDay(dayStart + 12 * HOUR), commitment }, at: openedAt });

  const reason = `In the draw for ${fmtDay(dayStart + 12 * HOUR)}; results at ${fmtDateTime(closesAt)}. Your chance is weighted by your priority score. Asking early gives no advantage. Draw page: /fairness/rounds/${roundId}`;
  const open: (Entry & { existing?: boolean })[] = [
    { id: "d8a2f4-laser", userId: "u-divya", from: 13, to: 15, purposeType: "coursework", purpose: "", existing: true },
    { id: "b5e1c7-laser", userId: "u-farhan", from: 14, to: 16, purposeType: "personal", purpose: "", existing: true },
    { id: "e7c3a1-laser", userId: "u-priya", from: 13.5, to: 15.5, purposeType: "coursework", purpose: "Cutting the acrylic lid and cable glands for the EC6702 weather station (final version)." },
  ];
  for (const [i, e] of open.entries()) {
    const at = openedAt + i * 4 * HOUR;
    const { score, factors } = await scoreFor(e.userId, laser.id, e.purposeType, at);
    const fields = { start: dayStart + e.from * HOUR, end: dayStart + e.to * HOUR, status: "pending" as const, roundId, decisionReason: reason, priorityScore: score, priorityBreakdown: JSON.stringify(factors), createdAt: at };
    if (e.existing) await db.update(B).set(fields).where(eq(B.id, e.id));
    else {
      await db.insert(B).values({
        id: e.id,
        resourceId: laser.id,
        userId: e.userId,
        purpose: e.purpose,
        purposeType: e.purposeType,
        eligibilitySnapshot: JSON.stringify({ eligible: true, checks: [], needsSupervision: true }),
        ...fields,
      });
      await audit({ actorId: e.userId, action: "booking.requested", entityType: "booking", entityId: e.id, details: { resource: laser.name, priority: score, roundId }, at });
    }
    await audit({ actorId: null, action: "round.entered", entityType: "booking", entityId: e.id, details: { roundId, weightScore: score, credits: creditOf(e.userId, laser.id) }, at });
  }
  await db.insert(schema.notifications).values({
    id: crypto.randomUUID(),
    userId: "u-meena",
    kind: "info",
    title: `Draw open: Laser Cutter on ${fmtDay(dayStart + 12 * HOUR)}`,
    body: `3 entries so far. It draws automatically at ${fmtDateTime(closesAt)}; in demo mode you can run it now from the resource page.`,
    link: "/resources/r-laser#draw",
    read: false,
    createdAt: now - HOUR,
  });
}
