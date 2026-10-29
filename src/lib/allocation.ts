import "server-only";
// Allocation rounds: commit–reveal weighted lotteries for high-demand resources, plus fairness credits.
// The draw itself lives in ./lottery (pure, shared with the browser verifier).
import { and, asc, desc, eq, gt, inArray, lt, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AllocationRound, Booking, Resource, User } from "@/db/schema";
import { audit } from "./audit";
import { notify } from "./notify";
import { canManageResource } from "./auth";
import { roundTiming, weeklyHours } from "./rules";
import { MAX_CREDITS, CREDIT_POINTS, OUTCOME_LABEL, allocate, commitmentOf, newSeed, runDraw, type DrawLog, type DrawPerson } from "./lottery";
import { DAY, HOUR, fmtDateTime, fmtDay, fmtRange, fmtTime } from "./time";
import { WorkflowError, decide, demoMode, waitlistPosition } from "./workflow";

const R = schema.allocationRounds;
const B = schema.bookings;
const C = schema.fairnessCredits;
const HOLD = ["approved", "checked_out", "returned"] as const;

export const roundLink = (id: string) => `/fairness/rounds/${id}`;
export const parseLog = (r: Pick<AllocationRound, "results"> | null | undefined): DrawLog | null => {
  if (!r?.results) return null;
  try {
    return JSON.parse(r.results) as DrawLog;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------- fairness credits

export async function getCredits(userId: string, resourceId: string) {
  const row = await db.query.fairnessCredits.findFirst({ where: and(eq(C.userId, userId), eq(C.resourceId, resourceId)) });
  return row?.credits ?? 0;
}

async function setCredits(userId: string, resourceId: string, credits: number, now = Date.now()) {
  const value = Math.max(0, Math.min(MAX_CREDITS, credits));
  const row = await db.query.fairnessCredits.findFirst({ where: and(eq(C.userId, userId), eq(C.resourceId, resourceId)) });
  if (row) await db.update(C).set({ credits: value, updatedAt: now }).where(eq(C.id, row.id));
  else await db.insert(C).values({ id: crypto.randomUUID(), userId, resourceId, credits: value, updatedAt: now });
  return value;
}

// ---------------------------------------------------------------- rounds

/** The round a request for `start` would join, if requests for that day are still open. Creates it on first request. */
export async function roundForRequest(resource: Resource, start: number, now = Date.now()) {
  if (resource.allocationMode !== "rounds") return null;
  const { dayStart, closesAt } = roundTiming(resource, start);
  const existing = await db.query.allocationRounds.findFirst({ where: and(eq(R.resourceId, resource.id), eq(R.dayStart, dayStart)) });
  if (existing) return existing.status === "open" && now < existing.closesAt ? existing : null;
  if (now >= closesAt) return null;
  const seed = newSeed();
  const round: AllocationRound = {
    id: crypto.randomUUID(),
    resourceId: resource.id,
    dayStart,
    closesAt,
    status: "open",
    seedCommitment: await commitmentOf(seed),
    seed: null,
    results: null,
    drawnAt: null,
    createdAt: now,
  };
  // The seed is stored but never shown until the draw; the commitment is public from this moment.
  await db.insert(R).values({ ...round, seed });
  await audit({
    actorId: null,
    action: "round.opened",
    entityType: "resource",
    entityId: resource.id,
    details: { roundId: round.id, day: fmtDay(dayStart + 12 * HOUR), closes: fmtDateTime(closesAt), commitment: round.seedCommitment },
  });
  await notify(
    resource.ownerId,
    "info",
    `Draw opened: ${resource.name} on ${fmtDay(dayStart + 12 * HOUR)}`,
    `Requests for that day are pooled and drawn at ${fmtDateTime(closesAt)}. Seed commitment ${round.seedCommitment.slice(0, 12)}… is published.`,
    roundLink(round.id),
  );
  return round;
}

/** What a member would see before requesting `start` on a rounds resource (no writes). */
export async function roundPreview(resource: Resource, start: number, now: number) {
  if (resource.allocationMode !== "rounds") return { kind: "review" as const };
  const { dayStart, closesAt } = roundTiming(resource, start);
  const round = await db.query.allocationRounds.findFirst({ where: and(eq(R.resourceId, resource.id), eq(R.dayStart, dayStart)) });
  if (round?.status === "drawn") return { kind: "drawn" as const, round, closesAt };
  if (now >= closesAt) return { kind: "late" as const, round: round ?? null, closesAt };
  const entries = round ? (await db.select({ id: B.id }).from(B).where(and(eq(B.roundId, round.id), eq(B.status, "pending")))).length : 0;
  return { kind: "join" as const, round: round ?? null, closesAt, entries };
}

export async function roundsForResource(resourceId: string) {
  return db.select().from(R).where(eq(R.resourceId, resourceId)).orderBy(desc(R.dayStart));
}

export async function entriesOf(roundId: string) {
  return db.select().from(B).where(eq(B.roundId, roundId)).orderBy(asc(B.createdAt));
}

/** True while a booking sits in a round that has not been drawn yet. */
export async function inOpenRound(b: Pick<Booking, "roundId" | "status">) {
  if (!b.roundId || b.status !== "pending") return null;
  const r = await db.query.allocationRounds.findFirst({ where: eq(R.id, b.roundId) });
  return r?.status === "open" ? r : null;
}

/** Draw ranks for waiting-list ordering: within one round, the draw order is the queue order. */
export async function drawRanks(bookings: Pick<Booking, "id" | "roundId">[]) {
  const ids = [...new Set(bookings.map((b) => b.roundId).filter(Boolean))] as string[];
  const ranks = new Map<string, { roundId: string; rank: number }>();
  if (!ids.length) return ranks;
  for (const r of await db.select().from(R).where(inArray(R.id, ids))) {
    for (const e of parseLog(r)?.entries ?? []) ranks.set(e.bookingId, { roundId: r.id, rank: e.rank });
  }
  return ranks;
}

/** Comparator: same round ⇒ draw rank; otherwise priority, then who asked first. */
export function queueOrder(ranks: Map<string, { roundId: string; rank: number }>) {
  return (x: Booking, y: Booking) => {
    const rx = ranks.get(x.id);
    const ry = ranks.get(y.id);
    if (rx && ry && rx.roundId === ry.roundId) return rx.rank - ry.rank;
    return y.priorityScore - x.priorityScore || x.createdAt - y.createdAt;
  };
}

// ---------------------------------------------------------------- the draw

/**
 * Reveal the seed and allocate. Idempotent: the round is claimed atomically (open → drawn) so two
 * concurrent sweeps can never draw twice.
 */
export async function drawRound(roundId: string, actor: User | null, opts: { early?: boolean } = {}) {
  const now = Date.now();
  const claimed = await db.update(R).set({ status: "drawn", drawnAt: now }).where(and(eq(R.id, roundId), eq(R.status, "open"))).returning();
  const round = claimed[0];
  if (!round) throw new WorkflowError("This round has already been drawn.");
  const resource = (await db.query.resources.findFirst({ where: eq(schema.resources.id, round.resourceId) }))!;
  const seed = round.seed!;
  const day = fmtDay(round.dayStart + 12 * HOUR);
  const link = roundLink(round.id);

  const entries = (await entriesOf(round.id)).filter((b) => b.status === "pending");
  // Pseudonymous entrant numbers in order of first entry.
  const personOf = new Map<string, number>();
  for (const b of entries) if (!personOf.has(b.userId)) personOf.set(b.userId, personOf.size + 1);

  const people: DrawPerson[] = [];
  for (const [userId, person] of personOf) {
    const mine = (await db.select().from(B).where(eq(B.userId, userId))).filter((b) => b.roundId !== round.id);
    const held = weeklyHours(mine, resource.id, round.dayStart + 12 * HOUR);
    people.push({ person, capHours: Math.max(0, resource.weeklyHourCap - held) });
  }
  const blocked = (
    await db
      .select({ start: B.start, end: B.end, roundId: B.roundId })
      .from(B)
      .where(and(eq(B.resourceId, resource.id), inArray(B.status, [...HOLD]), lt(B.start, round.dayStart + DAY), gt(B.end, round.dayStart)))
  )
    .filter((b) => b.roundId !== round.id)
    .map(({ start, end }) => ({ start, end }));

  const results = await runDraw(
    seed,
    entries.map((b) => ({ bookingId: b.id, person: personOf.get(b.userId)!, start: b.start, end: b.end, score: b.priorityScore })),
    blocked,
    people,
  );
  const log: DrawLog = {
    version: 1,
    algorithm: "Efraimidis–Spirakis weighted random order, u from HMAC-SHA256(seed, booking id), greedy non-overlapping allocation with fair-share caps",
    weightFormula: "w = max(score, 10) / 10",
    resourceId: resource.id,
    dayStart: round.dayStart,
    closesAt: round.closesAt,
    drawnAt: now,
    early: Boolean(opts.early),
    commitment: round.seedCommitment,
    blocked,
    people,
    entries: results,
    overrides: [],
  };
  await db.update(R).set({ results: JSON.stringify(log) }).where(eq(R.id, round.id));

  const n = results.length;
  const winners = results.filter((e) => e.outcome === "won");
  for (const e of results) {
    const b = entries.find((x) => x.id === e.bookingId)!;
    const keyText = `your key was ${e.key.toFixed(4)} (weight ${e.weight.toFixed(1)}), drawn ${ordinal(e.rank)} of ${n}`;
    if (e.outcome === "won") {
      await setCredits(b.userId, resource.id, 0, now);
      const why = `Won the draw — awaiting owner confirmation. In the draw for ${day} ${keyText}; your slot was free when your turn came. Any fairness credits on this resource are now used up. Verify: ${link}`;
      await db.update(B).set({ decisionReason: why }).where(eq(B.id, b.id));
      await audit({ actorId: null, action: "round.won", entityType: "booking", entityId: b.id, details: { roundId: round.id, rank: e.rank, key: e.key.toFixed(6), weight: e.weight } });
      await notify(b.userId, "approved", `You won the draw: ${resource.name}`, `${fmtRange(b.start, b.end)}. The owner confirms winners shortly. ${capitalise(keyText)}.`, `/bookings/${b.id}`);
    } else {
      const credits = await setCredits(b.userId, resource.id, (await getCredits(b.userId, resource.id)) + 1, now);
      const beat = e.beatenBy ? results.find((x) => x.rank === e.beatenBy) : null;
      const cause =
        e.outcome === "overlap" && beat
          ? `The ${fmtTime(beat.start)}–${fmtTime(beat.end)} slot overlapping yours went to the entry drawn ${ordinal(beat.rank)} (key ${beat.key.toFixed(4)}), before your turn.`
          : e.outcome === "cap"
            ? `Taking this slot would have put you over the ${resource.weeklyHourCap} h fair-share cap, counting what you already hold or won earlier in this draw.`
            : `Your time clashes with a booking that was already approved before the draw.`;
      const why = `Not this time. In the draw for ${day} ${keyText}. ${cause} You are on the waiting list and move up automatically if a winner cancels. You earned +1 fairness credit on this resource (now ${credits}, worth +${CREDIT_POINTS * credits} priority next time). Verify: ${link}`;
      await db.update(B).set({ status: "waitlisted", decisionReason: why }).where(eq(B.id, b.id));
      await audit({
        actorId: null,
        action: "round.lost",
        entityType: "booking",
        entityId: b.id,
        details: { roundId: round.id, rank: e.rank, key: e.key.toFixed(6), outcome: OUTCOME_LABEL[e.outcome], creditsNow: credits },
      });
    }
  }
  // Notify losers after all statuses are written so waiting-list positions are final.
  for (const e of results.filter((x) => x.outcome !== "won")) {
    const b = (await db.query.bookings.findFirst({ where: eq(B.id, e.bookingId) }))!;
    const pos = await waitlistPosition(b);
    await notify(b.userId, "waitlisted", `Not drawn this time: ${resource.name}`, `Waiting list #${pos} for ${fmtRange(b.start, b.end)}. +1 fairness credit. See exactly why and verify the draw.`, `/bookings/${b.id}`);
  }
  await audit({
    actorId: actor?.id ?? null,
    action: "round.drawn",
    entityType: "resource",
    entityId: resource.id,
    details: { roundId: round.id, day, entries: n, winners: winners.length, seed, commitment: round.seedCommitment, early: Boolean(opts.early) },
  });
  await notify(
    resource.ownerId,
    "review",
    `Draw complete: ${resource.name} on ${day}`,
    n ? `${winners.length} winner(s) of ${n} entries are waiting for your confirmation.` : "Nobody entered this round.",
    `/resources/${resource.id}#draw`,
  );
  return { winners: winners.length, entries: n };
}

/** Called by sweep(): draw every round whose closing time has passed. */
export async function drawDueRounds(now = Date.now()) {
  const due = await db.select({ id: R.id }).from(R).where(and(eq(R.status, "open"), lte(R.closesAt, now)));
  for (const r of due) {
    try {
      await drawRound(r.id, null);
    } catch (e) {
      if (!(e instanceof WorkflowError)) throw e;
    }
  }
}

async function managedRound(actor: User, roundId: string) {
  const round = await db.query.allocationRounds.findFirst({ where: eq(R.id, roundId) });
  if (!round) throw new WorkflowError("Round not found.");
  const resource = (await db.query.resources.findFirst({ where: eq(schema.resources.id, round.resourceId) }))!;
  if (!canManageResource(actor, resource)) throw new WorkflowError("You do not manage this resource.");
  return { round, resource };
}

/** Owner shortcut so judges need not wait for the closing time. Only in demo mode. */
export async function runDrawNow(actor: User, roundId: string) {
  if (!demoMode()) throw new WorkflowError("Draws run automatically at closing time. Early draws are only allowed in demo mode.");
  const { round } = await managedRound(actor, roundId);
  if (round.status !== "open") throw new WorkflowError("This round has already been drawn.");
  return drawRound(round.id, actor, { early: true });
}

/** Human oversight: the owner confirms every winner in one click (each still re-checked by decide()). */
export async function confirmWinners(actor: User, roundId: string) {
  const { round, resource } = await managedRound(actor, roundId);
  const log = parseLog(round);
  if (round.status !== "drawn" || !log) throw new WorkflowError("Run the draw first.");
  // Everyone still pending in a drawn round is a winner or moved up in draw order; confirm in draw order.
  const rank = new Map(log.entries.map((e) => [e.bookingId, e.rank]));
  const pending = (await entriesOf(round.id)).filter((b) => b.status === "pending").sort((x, y) => (rank.get(x.id) ?? 99) - (rank.get(y.id) ?? 99));
  if (!pending.length) throw new WorkflowError("No winners are waiting for confirmation.");
  const failed: string[] = [];
  let ok = 0;
  for (const b of pending) {
    try {
      await decide(actor, b.id, "approve", `Confirmed draw winner for ${fmtDay(round.dayStart + 12 * HOUR)} (verifiable at ${roundLink(round.id)}).`);
      ok++;
    } catch (e) {
      if (!(e instanceof WorkflowError)) throw e;
      failed.push(e.message);
    }
  }
  await audit({ actorId: actor.id, action: "round.winners_confirmed", entityType: "resource", entityId: resource.id, details: { roundId: round.id, confirmed: ok, failed: failed.length } });
  return { ok, failed };
}

/**
 * Owner overrides one winner (e.g. the stated purpose breaks a usage rule). The winner is rejected with the
 * reason, gets a fairness credit back, and the allocation is re-run with the SAME keys so whoever is next in
 * the published draw order moves up. Overrides are logged next to the draw on the public page.
 */
export async function overrideWinner(actor: User, bookingId: string, reason: string) {
  if (reason.trim().length < 10) throw new WorkflowError("Give a reason of at least 10 characters. It is shown on the public draw page.");
  const b = await db.query.bookings.findFirst({ where: eq(B.id, bookingId) });
  if (!b?.roundId) throw new WorkflowError("This booking is not part of a draw.");
  const { round, resource } = await managedRound(actor, b.roundId);
  const log = parseLog(round);
  if (!log) throw new WorkflowError("This round has not been drawn yet.");
  if (b.status !== "pending") throw new WorkflowError(`Only winners awaiting confirmation can be overridden (this one is ${b.status}).`);
  const now = Date.now();
  const note = `Owner override after the draw: ${reason.trim()}`;
  await db.update(B).set({ status: "rejected", decisionReason: note, decidedBy: actor.id }).where(eq(B.id, b.id));
  const credits = await setCredits(b.userId, resource.id, (await getCredits(b.userId, resource.id)) + 1, now);
  await notify(b.userId, "rejected", `Draw win overridden: ${resource.name}`, `${note} You received +1 fairness credit (now ${credits}).`, `/bookings/${b.id}`);

  // Re-run the allocation with the published keys, excluding everyone overridden so far.
  const excluded = new Set([...log.overrides.map((o) => o.bookingId), b.id]);
  const outcome = allocate(log.entries, log.blocked, log.people, excluded);
  const promoted: string[] = [];
  for (const e of log.entries) {
    if (outcome.get(e.bookingId)?.outcome !== "won") continue;
    const cur = await db.query.bookings.findFirst({ where: eq(B.id, e.bookingId) });
    if (cur?.status !== "waitlisted") continue;
    promoted.push(cur.id);
    await setCredits(cur.userId, resource.id, 0, now);
    const why = `Won the draw — awaiting owner confirmation. You moved up: an entry drawn before you was overridden by the owner, and you were next in the published draw order (drawn ${ordinal(e.rank)}). Verify: ${roundLink(round.id)}`;
    await db.update(B).set({ status: "pending", decisionReason: why }).where(eq(B.id, cur.id));
    await audit({ actorId: actor.id, action: "booking.promoted", entityType: "booking", entityId: cur.id, details: { reason: why, roundId: round.id } });
    await notify(cur.userId, "promoted", `You moved up in the draw: ${resource.name}`, why, `/bookings/${cur.id}`);
  }
  log.overrides.push({ bookingId: b.id, reason: reason.trim(), at: now, promoted });
  await db.update(R).set({ results: JSON.stringify(log) }).where(eq(R.id, round.id));
  await audit({ actorId: actor.id, action: "round.winner_overridden", entityType: "booking", entityId: b.id, details: { roundId: round.id, reason: reason.trim(), promoted: promoted.length } });
  return { promoted: promoted.length };
}

/** Winners still waiting for the owner, per drawn round on a resource. */
export async function awaitingConfirmation(resourceId: string) {
  const rounds = (await roundsForResource(resourceId)).filter((r) => r.status === "drawn");
  const out: { round: AllocationRound; winners: Booking[] }[] = [];
  for (const r of rounds) {
    const winners = (await entriesOf(r.id)).filter((b) => b.status === "pending");
    if (winners.length) out.push({ round: r, winners });
  }
  return out;
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
