import "server-only";
import { and, eq, inArray, lt, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Booking, Incident, Resource, User } from "@/db/schema";
import { audit } from "./audit";
import { notify } from "./notify";
import { canManageResource } from "./auth";
import { reviewRequest, summarizeIncident } from "./ai";
import { evaluate, priorityScore, profileChecks, windowChecks, eligibilitySummary, type Eligibility } from "./rules";
import { STRIKE_LIMIT, conditionLabel, conditionRank } from "./catalog";
import { HOUR, fmtDateTime, fmtDay, fmtRange } from "./time";
import { drawDueRounds, drawRanks, getCredits, inOpenRound, queueOrder, roundForRequest, roundLink } from "./allocation";
import { verifyHandoverProof } from "./handover";
import { checkInWindow, photoRequired, type ProofInput } from "./handover-rules";

export class WorkflowError extends Error {}

const T = schema.bookings;
const ref = (id: string) => `LL-${id.slice(0, 6).toUpperCase()}`;
export const bookingRef = ref;

export const demoMode = () => process.env.DEMO_MODE !== "false";

async function getBooking(id: string) {
  const b = await db.query.bookings.findFirst({ where: eq(T.id, id) });
  if (!b) throw new WorkflowError("Booking not found.");
  const r = await db.query.resources.findFirst({ where: eq(schema.resources.id, b.resourceId) });
  if (!r) throw new WorkflowError("Resource not found.");
  return { b, r };
}

async function userBookings(userId: string) {
  return db.select().from(T).where(eq(T.userId, userId));
}

export async function eligibilityFor(user: User, resource: Resource, window?: { start: number; end: number }, excludeId?: string): Promise<Eligibility> {
  const certs = await db.select().from(schema.certifications).where(eq(schema.certifications.userId, user.id));
  const checks = profileChecks(user, resource, certs);
  if (window) checks.push(...windowChecks(user, resource, window.start, window.end, await userBookings(user.id), Date.now(), excludeId));
  return evaluate(checks, resource);
}

/** Bookings that hold a slot (block others). */
async function slotHolders(resourceId: string, start: number, end: number, excludeId?: string) {
  const rows = await db
    .select()
    .from(T)
    .where(and(eq(T.resourceId, resourceId), inArray(T.status, ["approved", "checked_out", "returned"]), lt(T.start, end), gt(T.end, start)));
  return rows.filter((b) => b.id !== excludeId);
}

async function competing(resourceId: string, start: number, end: number, excludeId?: string) {
  const rows = await db
    .select()
    .from(T)
    .where(and(eq(T.resourceId, resourceId), inArray(T.status, ["pending", "waitlisted"]), lt(T.start, end), gt(T.end, start)));
  return rows.filter((b) => b.id !== excludeId);
}

export async function waitlistPosition(b: Booking) {
  const queue = (await competing(b.resourceId, b.start, b.end)).concat(b).filter((x) => x.status === "waitlisted");
  const unique = [...new Map(queue.map((x) => [x.id, x])).values()];
  // Draw losers queue in the published draw order; everyone else by priority, then who asked first.
  unique.sort(queueOrder(await drawRanks(unique)));
  return unique.findIndex((x) => x.id === b.id) + 1;
}

// ---------------------------------------------------------------- request

export async function requestBooking(
  user: User,
  input: { resourceId: string; start: number; end: number; purposeType: Booking["purposeType"]; purpose: string },
) {
  const resource = await db.query.resources.findFirst({ where: eq(schema.resources.id, input.resourceId) });
  if (!resource) throw new WorkflowError("Resource not found.");
  if (input.purpose.trim().length < 10) throw new WorkflowError("Please describe what you will use it for (at least 10 characters).");

  const elig = await eligibilityFor(user, resource, input);
  if (!elig.eligible) throw new WorkflowError(`Not eligible yet. ${eligibilitySummary(elig)}`);

  const history = await userBookings(user.id);
  const now = Date.now();
  const credits = await getCredits(user.id, resource.id);
  const { score, factors } = priorityScore({ purposeType: input.purposeType, createdAt: now, resourceId: resource.id }, user, history, now, credits);
  const holders = await slotHolders(resource.id, input.start, input.end);
  const rivals = await competing(resource.id, input.start, input.end);
  const pastIncidents = await db.select({ id: schema.incidents.id }).from(schema.incidents).where(eq(schema.incidents.subjectUserId, user.id));

  const id = crypto.randomUUID();
  let status: Booking["status"] = "pending";
  let reason: string | null = null;
  const decidedBy: string | null = null;
  // High-demand resources pool requests for a day into a verifiable weighted draw (see /policy).
  const round = holders.length ? null : await roundForRequest(resource, input.start, now);

  if (holders.length) {
    status = "waitlisted";
    reason = `This slot overlaps an approved booking (${holders.map((h) => fmtRange(h.start, h.end)).join("; ")}). You are on the waiting list and will be moved up automatically if it frees up.`;
  } else if (round) {
    reason = `In the draw for ${fmtDay(round.dayStart + 12 * HOUR)}; results at ${fmtDateTime(round.closesAt)}. Your chance is weighted by your priority score (${score}). Asking early gives no advantage. Draw page: ${roundLink(round.id)}`;
  } else if (resource.autoApprove && !resource.supervisionRequired && rivals.length === 0) {
    status = "approved";
    reason = "Auto-approved: the owner allows instant booking for this low-risk resource, all requirements were met and there was no competing request.";
  }

  const ai = await reviewRequest({
    resource: {
      name: resource.name,
      category: resource.category,
      usageRules: resource.usageRules,
      supervisionRequired: resource.supervisionRequired,
      depositRequired: resource.depositRequired,
      maxHours: resource.maxHours,
    },
    requester: {
      affiliation: user.affiliation,
      department: user.department,
      strikes: user.strikes,
      pastBookings: history.filter((h) => h.status === "closed").length,
      pastIncidents: pastIncidents.length,
    },
    purposeType: input.purposeType,
    purpose: input.purpose,
    hours: (input.end - input.start) / HOUR,
    failedChecks: [],
    competingRequests: rivals.length,
  });

  await db.insert(T).values({
    id,
    resourceId: resource.id,
    userId: user.id,
    start: input.start,
    end: input.end,
    purpose: input.purpose.trim(),
    purposeType: input.purposeType,
    status,
    decisionReason: reason,
    decidedBy,
    eligibilitySnapshot: JSON.stringify(elig),
    priorityScore: score,
    priorityBreakdown: JSON.stringify(factors),
    aiReview: JSON.stringify(ai),
    roundId: round?.id ?? null,
    createdAt: now,
  });
  await audit({ actorId: user.id, action: "booking.requested", entityType: "booking", entityId: id, details: { resource: resource.name, slot: fmtRange(input.start, input.end), priority: score, roundId: round?.id ?? null } });

  const link = `/bookings/${id}`;
  if (round) {
    await audit({ actorId: null, action: "round.entered", entityType: "booking", entityId: id, details: { roundId: round.id, weightScore: score, credits } });
    await notify(user.id, "submitted", `Entered the draw: ${resource.name}`, `${fmtRange(input.start, input.end)}. ${reason}`, link);
  } else if (status === "approved") {
    await audit({ actorId: null, action: "booking.auto_approved", entityType: "booking", entityId: id, details: { rule: "owner auto-approve" } });
    await notify(user.id, "approved", `Approved: ${resource.name}`, `${fmtRange(input.start, input.end)}. ${reason}`, link);
    await notify(resource.ownerId, "info", `Auto-approved booking for ${resource.name}`, `${user.name} · ${fmtRange(input.start, input.end)}`, link);
  } else if (status === "waitlisted") {
    await audit({ actorId: null, action: "booking.waitlisted", entityType: "booking", entityId: id, details: { reason } });
    const pos = await waitlistPosition({ ...(await db.query.bookings.findFirst({ where: eq(T.id, id) }))! });
    await notify(user.id, "waitlisted", `Waiting list #${pos}: ${resource.name}`, reason!, link);
  } else {
    await notify(user.id, "submitted", `Request sent: ${resource.name}`, `The owner will review your request for ${fmtRange(input.start, input.end)}.`, link);
    await notify(
      resource.ownerId,
      "review",
      `New request for ${resource.name}`,
      `${user.name} (${user.department}) · ${fmtRange(input.start, input.end)}${rivals.length ? ` · ${rivals.length} competing request(s)` : ""}`,
      `/manage`,
    );
  }
  return { id, status };
}

// ---------------------------------------------------------------- decisions

export async function decide(actor: User, bookingId: string, decision: "approve" | "reject" | "waitlist", reason: string) {
  const { b, r } = await getBooking(bookingId);
  if (!canManageResource(actor, r)) throw new WorkflowError("You do not manage this resource.");
  if (!["pending", "waitlisted"].includes(b.status)) throw new WorkflowError(`This request is already ${b.status}.`);
  const openRound = decision === "reject" ? null : await inOpenRound(b);
  if (openRound)
    throw new WorkflowError(
      `This request is in the draw for ${fmtDay(openRound.dayStart + 12 * HOUR)}, which closes ${fmtDateTime(openRound.closesAt)}. Winners are decided by the published draw, then you confirm them. You can still reject it with a reason if it breaks a rule.`,
    );
  if (decision !== "approve" && reason.trim().length < 5) throw new WorkflowError("Please give the requester a reason.");
  const requester = (await db.query.users.findFirst({ where: eq(schema.users.id, b.userId) }))!;
  const link = `/bookings/${b.id}`;

  if (decision === "approve") {
    const holders = await slotHolders(r.id, b.start, b.end, b.id);
    if (holders.length) throw new WorkflowError("Cannot approve: the slot overlaps an approved booking. Waitlist or reject instead.");
    const elig = await eligibilityFor(requester, r, { start: b.start, end: b.end }, b.id);
    const profileFail = elig.checks.filter((c) => !c.pass && !["horizon", "open-requests"].includes(c.key));
    if (profileFail.length) throw new WorkflowError(`Requester no longer meets: ${profileFail.map((c) => c.label).join(", ")}.`);
    const note = reason.trim() || "Approved by the resource owner. All requirements were met.";
    await db.update(T).set({ status: "approved", decisionReason: note, decidedBy: actor.id }).where(eq(T.id, b.id));
    await audit({ actorId: actor.id, action: "booking.approved", entityType: "booking", entityId: b.id, details: { reason: note } });
    await notify(requester.id, "approved", `Approved: ${r.name}`, `${fmtRange(b.start, b.end)}. ${note}`, link);

    // Everyone else asking for an overlapping slot now waits, with an explanation.
    for (const rival of await competing(r.id, b.start, b.end, b.id)) {
      if (rival.status === "waitlisted") continue;
      const why = `Another request for an overlapping slot was approved (priority ${b.priorityScore} vs your ${rival.priorityScore}). You are on the waiting list and will move up if the slot frees.`;
      await db.update(T).set({ status: "waitlisted", decisionReason: why, decidedBy: actor.id }).where(eq(T.id, rival.id));
      await audit({ actorId: actor.id, action: "booking.waitlisted", entityType: "booking", entityId: rival.id, details: { reason: why, slotGivenTo: ref(b.id) } });
      const pos = await waitlistPosition({ ...rival, status: "waitlisted" });
      await notify(rival.userId, "waitlisted", `Waiting list #${pos}: ${r.name}`, why, `/bookings/${rival.id}`);
    }
  } else if (decision === "reject") {
    await db.update(T).set({ status: "rejected", decisionReason: reason.trim(), decidedBy: actor.id }).where(eq(T.id, b.id));
    await audit({ actorId: actor.id, action: "booking.rejected", entityType: "booking", entityId: b.id, details: { reason } });
    await notify(requester.id, "rejected", `Not approved: ${r.name}`, reason.trim(), link);
  } else {
    await db.update(T).set({ status: "waitlisted", decisionReason: reason.trim(), decidedBy: actor.id }).where(eq(T.id, b.id));
    await audit({ actorId: actor.id, action: "booking.waitlisted", entityType: "booking", entityId: b.id, details: { reason } });
    const pos = await waitlistPosition({ ...b, status: "waitlisted" });
    await notify(requester.id, "waitlisted", `Waiting list #${pos}: ${r.name}`, reason.trim(), link);
  }
}

/** A slot freed up: move waiting requests that no longer conflict back into review, best priority first. */
async function promoteWaitlist(resource: Resource, freed: { start: number; end: number }) {
  const waiting = (await competing(resource.id, freed.start, freed.end)).filter((w) => w.status === "waitlisted");
  waiting.sort(queueOrder(await drawRanks(waiting)));
  for (const w of waiting) {
    if ((await slotHolders(resource.id, w.start, w.end)).length) continue;
    if (w.end < Date.now()) continue;
    const why = w.roundId
      ? "A slot opened up. Your request is back with the owner for review (you were next in the published draw order)."
      : "A slot opened up. Your request is back with the owner for review (you were first in line by priority).";
    await db.update(T).set({ status: "pending", decisionReason: why }).where(eq(T.id, w.id));
    await audit({ actorId: null, action: "booking.promoted", entityType: "booking", entityId: w.id, details: { reason: why } });
    await notify(w.userId, "promoted", `Moved up: ${resource.name}`, why, `/bookings/${w.id}`);
    await notify(resource.ownerId, "review", `Waiting-list request ready for review`, `${resource.name} · ${fmtRange(w.start, w.end)}`, "/manage");
  }
}

export async function cancelBooking(actor: User, bookingId: string, reason: string) {
  const { b, r } = await getBooking(bookingId);
  const own = b.userId === actor.id;
  if (!own && !canManageResource(actor, r)) throw new WorkflowError("Not allowed.");
  if (!["pending", "approved", "waitlisted"].includes(b.status)) throw new WorkflowError("Only upcoming bookings can be cancelled.");
  if (!own && reason.trim().length < 5) throw new WorkflowError("Give the requester a reason for cancelling.");
  const note = reason.trim() || "Cancelled by requester.";
  await db.update(T).set({ status: "cancelled", decisionReason: note, decidedBy: actor.id }).where(eq(T.id, b.id));
  await audit({ actorId: actor.id, action: "booking.cancelled", entityType: "booking", entityId: b.id, details: { reason: note, by: own ? "requester" : "manager", hoursBeforeStart: Math.round((b.start - Date.now()) / HOUR) } });
  if (own) await notify(r.ownerId, "cancelled", `Cancelled: ${r.name}`, `${actor.name} cancelled ${fmtRange(b.start, b.end)}.`, `/bookings/${b.id}`);
  else await notify(b.userId, "cancelled", `Your booking was cancelled: ${r.name}`, note, `/bookings/${b.id}`);
  // A cancelled approval, or a draw winner withdrawing before confirmation, frees the slot for the queue.
  if (b.status === "approved" || (b.status === "pending" && b.roundId && !(await inOpenRound(b)))) await promoteWaitlist(r, b);
}

export async function extendBooking(actor: User, bookingId: string, newEnd: number) {
  const { b, r } = await getBooking(bookingId);
  if (b.userId !== actor.id) throw new WorkflowError("Only the borrower can request an extension.");
  if (!["approved", "checked_out"].includes(b.status)) throw new WorkflowError("Only active bookings can be extended.");
  if (newEnd <= b.end) throw new WorkflowError("New end time must be later than the current one.");
  const user = (await db.query.users.findFirst({ where: eq(schema.users.id, actor.id) }))!;
  const window = windowChecks(user, r, b.start, newEnd, await userBookings(actor.id), b.start, b.id).filter((c) => c.key !== "horizon" && c.key !== "open-requests");
  const clash = [...(await slotHolders(r.id, b.end, newEnd, b.id)), ...(await competing(r.id, b.end, newEnd, b.id))];
  const failed = window.filter((c) => !c.pass);
  if (failed.length || clash.length) {
    const why = clash.length ? "Someone else has requested or booked the time right after yours." : failed.map((c) => `${c.label}: ${c.detail}`).join(" ");
    await audit({ actorId: actor.id, action: "booking.extension_denied", entityType: "booking", entityId: b.id, details: { requestedEnd: newEnd, reason: why } });
    throw new WorkflowError(`Extension not possible. ${why}`);
  }
  await db.update(T).set({ end: newEnd, overdueNotifiedAt: null }).where(eq(T.id, b.id));
  await audit({ actorId: actor.id, action: "booking.extended", entityType: "booking", entityId: b.id, details: { from: b.end, to: newEnd, rule: "no conflicts and within limits" } });
  await notify(r.ownerId, "info", `Extended: ${r.name}`, `${actor.name} extended to ${fmtRange(b.start, newEnd)} (no conflicts, within limits).`, `/bookings/${b.id}`);
}

// ---------------------------------------------------------------- hand-over

type ConditionInput = { condition: string; notes: string; photo?: string | null };

function checkConditionInput(r: Resource, c: ConditionInput) {
  if (!conditionRank(c.condition)) throw new WorkflowError("Record the condition.");
  if (c.notes.length > 1000) throw new WorkflowError("Keep the notes under 1000 characters.");
  if (c.photo && (!/^data:image\/(jpeg|png|webp);base64,/.test(c.photo) || c.photo.length > 1_500_000)) throw new WorkflowError("Photo is invalid or too large.");
  if (!c.photo && photoRequired(r))
    throw new WorkflowError(
      r.supervisionRequired ? "A condition photo is required for supervised items. Take one of the item as it is now." : `A condition photo is required because this item carries a ₹${r.depositRequired} deposit. It protects you if something is disputed later.`,
    );
}

/**
 * Pick-up. `proof` shows the person is physically at the item: a QR tag scan, a staff one-time code,
 * or staff recording it in person. See handover-rules.ts for which methods each person may use.
 */
export async function checkOut(actor: User, bookingId: string, c: ConditionInput, proof: ProofInput | null) {
  const { b, r } = await getBooking(bookingId);
  const staff = canManageResource(actor, r);
  if (b.userId !== actor.id && !staff) throw new WorkflowError("Only the borrower or the staff who manage this item can check it in.");
  if (b.status === "checked_out") throw new WorkflowError("This booking is already checked in.");
  if (b.status !== "approved") throw new WorkflowError("Only approved bookings can be checked in.");
  const now = Date.now();
  const window = checkInWindow(b, now, demoMode());
  if (window === "early") throw new WorkflowError(`Too early: check-in opens 30 minutes before your slot (${fmtRange(b.start, b.end)}).`);
  if (window === "ended") throw new WorkflowError("This slot has already ended. Book a new slot.");
  checkConditionInput(r, c);
  const p = await verifyHandoverProof(actor, b, r, "check_out", proof);
  const done = await db
    .update(T)
    .set({ status: "checked_out", checkOutAt: now, checkOutCondition: c.condition, checkOutNotes: c.notes.trim() || null, checkOutPhoto: c.photo || null, checkOutMethod: p.method })
    .where(and(eq(T.id, b.id), eq(T.status, "approved")))
    .returning({ id: T.id });
  if (!done.length) throw new WorkflowError("This booking changed while you were checking in. Reload the page.");
  const coSigner = p.coSignerId ? (await db.query.users.findFirst({ where: eq(schema.users.id, p.coSignerId) }))?.name ?? null : null;
  await audit({
    actorId: actor.id,
    action: "booking.checked_out",
    entityType: "booking",
    entityId: b.id,
    details: { condition: c.condition, notes: c.notes, photo: Boolean(c.photo), proof: p.label, method: p.method, coSignedBy: coSigner, simulated: p.simulated },
  });
  const other = b.userId === actor.id ? r.ownerId : b.userId;
  await notify(other, "checked_out", `Checked in: ${r.name}`, `Condition at pick-up: ${conditionLabel(c.condition)}. ${p.label}. Due back ${fmtRange(b.start, b.end)}.`, `/bookings/${b.id}`);
}

/** Drop-off. Returns whether both photos exist, so the caller can schedule the vision comparison. */
export async function returnResource(actor: User, bookingId: string, c: ConditionInput, proof: ProofInput | null) {
  const { b, r } = await getBooking(bookingId);
  if (b.userId !== actor.id && !canManageResource(actor, r)) throw new WorkflowError("Only the borrower or the staff who manage this item can record the return.");
  if (b.status === "returned" || b.status === "closed") throw new WorkflowError("This item has already been returned.");
  if (b.status !== "checked_out") throw new WorkflowError("Only items in use can be returned.");
  checkConditionInput(r, c);
  const p = await verifyHandoverProof(actor, b, r, "return", proof);
  const now = Date.now();
  const comparePhotos = Boolean(b.checkOutPhoto && c.photo);
  const done = await db
    .update(T)
    .set({
      status: "returned",
      returnAt: now,
      returnCondition: c.condition,
      returnNotes: c.notes.trim() || null,
      returnPhoto: c.photo || null,
      returnMethod: p.method,
      aiConditionDiff: comparePhotos ? JSON.stringify({ status: "pending", requestedAt: now }) : null,
    })
    .where(and(eq(T.id, b.id), eq(T.status, "checked_out")))
    .returning({ id: T.id });
  if (!done.length) throw new WorkflowError("This booking changed while you were returning it. Reload the page.");
  const late = Math.max(0, Math.round((now - b.end) / 60_000));
  const coSigner = p.coSignerId ? (await db.query.users.findFirst({ where: eq(schema.users.id, p.coSignerId) }))?.name ?? null : null;
  await audit({
    actorId: actor.id,
    action: "booking.returned",
    entityType: "booking",
    entityId: b.id,
    details: { condition: c.condition, notes: c.notes, minutesLate: late, photo: Boolean(c.photo), proof: p.label, method: p.method, coSignedBy: coSigner, simulated: p.simulated },
  });
  await notify(r.ownerId, "returned", `Returned: ${r.name}`, `Borrower reports ${conditionLabel(c.condition)}${late ? `, ${late} min late` : ""}. ${p.label}. Please inspect and confirm.`, `/bookings/${b.id}`);
  if (conditionRank(c.condition) < conditionRank(b.checkOutCondition)) {
    await reportIncident(
      actor,
      {
        bookingId: b.id,
        resourceId: r.id,
        type: "damage",
        severity: conditionRank(c.condition) <= 1 ? "high" : "medium",
        description: `Condition dropped from "${conditionLabel(b.checkOutCondition)}" at pick-up to "${conditionLabel(c.condition)}" at return. Borrower notes: ${c.notes || "none"}`,
      },
      true,
    );
  }
  return { comparePhotos };
}

export async function confirmReturn(actor: User, bookingId: string, input: { condition: string; notes: string; reportDamage: boolean }) {
  const { b, r } = await getBooking(bookingId);
  if (!canManageResource(actor, r)) throw new WorkflowError("Only the owner or a manager can confirm a return.");
  if (b.status !== "returned") throw new WorkflowError("Nothing to confirm.");
  const note = `Return confirmed. Owner assessed condition: ${conditionLabel(input.condition)}.${input.notes ? ` ${input.notes}` : ""}`;
  await db.update(T).set({ status: "closed", returnConfirmedBy: actor.id, decisionReason: note }).where(eq(T.id, b.id));
  await audit({ actorId: actor.id, action: "booking.return_confirmed", entityType: "booking", entityId: b.id, details: { ownerCondition: input.condition, notes: input.notes, borrowerCondition: b.returnCondition } });
  await notify(b.userId, "closed", `Return confirmed: ${r.name}`, note, `/bookings/${b.id}`);
  if (input.reportDamage || conditionRank(input.condition) < conditionRank(b.returnCondition)) {
    await reportIncident(actor, {
      bookingId: b.id,
      resourceId: r.id,
      type: "damage",
      severity: conditionRank(input.condition) <= 1 ? "high" : "medium",
      description: `Owner inspection after return: ${conditionLabel(input.condition)} (borrower reported ${conditionLabel(b.returnCondition)}). ${input.notes}`,
    });
  }
}

// ---------------------------------------------------------------- incidents

export async function reportIncident(
  actor: User | null,
  input: { bookingId?: string | null; resourceId: string; type: Incident["type"]; severity: "low" | "medium" | "high"; description: string },
  system = false,
) {
  const r = await db.query.resources.findFirst({ where: eq(schema.resources.id, input.resourceId) });
  if (!r) throw new WorkflowError("Resource not found.");
  const b = input.bookingId ? await db.query.bookings.findFirst({ where: eq(T.id, input.bookingId) }) : undefined;
  if (actor && b && b.userId !== actor.id && !canManageResource(actor, r)) throw new WorkflowError("Not allowed.");
  if (input.description.trim().length < 10) throw new WorkflowError("Describe what happened (at least 10 characters).");
  const id = crypto.randomUUID();
  const ai = await summarizeIncident({
    type: input.type,
    severity: input.severity,
    description: input.description,
    resourceName: r.name,
    checkOutCondition: b?.checkOutCondition,
    returnCondition: b?.returnCondition,
    minutesLate: b?.returnAt ? Math.round((b.returnAt - b.end) / 60_000) : undefined,
  });
  await db.insert(schema.incidents).values({
    id,
    bookingId: b?.id ?? null,
    resourceId: r.id,
    reporterId: actor?.id ?? "system",
    subjectUserId: b?.userId ?? null,
    type: input.type,
    severity: input.severity,
    description: input.description.trim(),
    aiSummary: JSON.stringify(ai),
    status: "open",
    createdAt: Date.now(),
  });
  await audit({
    actorId: system ? null : (actor?.id ?? null),
    action: "incident.reported",
    entityType: "incident",
    entityId: id,
    bookingId: b?.id ?? null,
    details: { type: input.type, severity: input.severity, resource: r.name, autoFlagged: system },
  });
  const link = `/incidents/${id}`;
  await notify(r.ownerId, "incident", `Incident on ${r.name}`, `${input.type} · ${input.severity} severity. Needs human review.`, link);
  const managers = await db.select().from(schema.users).where(and(eq(schema.users.role, "manager"), eq(schema.users.department, r.department)));
  for (const m of managers) await notify(m.id, "incident", `Incident on ${r.name}`, `${input.type} · ${input.severity} severity.`, link);
  // The borrower always hears about it (including automatic reports) so they can add their side.
  if (b && (system || b.userId !== actor?.id)) await notify(b.userId, "incident", `An incident was filed on your booking`, `${input.type}: you can view it and add your side before a manager decides.`, link);
  return id;
}

export async function resolveIncident(
  actor: User,
  incidentId: string,
  input: { resolution: string; issueStrike: boolean; dismiss: boolean; readBothSides?: boolean },
) {
  const inc = await db.query.incidents.findFirst({ where: eq(schema.incidents.id, incidentId) });
  if (!inc) throw new WorkflowError("Incident not found.");
  const r = (await db.query.resources.findFirst({ where: eq(schema.resources.id, inc.resourceId) }))!;
  if (!(actor.role === "admin" || (actor.role === "manager" && r.department === actor.department)))
    throw new WorkflowError("Incidents are resolved by a department manager or administrator.");
  if (inc.status !== "open") throw new WorkflowError("Already closed.");
  if (input.resolution.trim().length < 10) throw new WorkflowError("Write a resolution note (at least 10 characters). It is shown to everyone involved.");
  const strike = input.issueStrike && !input.dismiss && Boolean(inc.subjectUserId);
  if (strike && !input.readBothSides) throw new WorkflowError("Confirm that you have read both sides before issuing a strike.");
  if (strike && inc.subjectUserId === actor.id) throw new WorkflowError("You cannot issue a strike to yourself. Ask another manager or an administrator.");
  const statements = await db.select({ role: schema.incidentStatements.role }).from(schema.incidentStatements).where(eq(schema.incidentStatements.incidentId, inc.id));
  const claimed = await db
    .update(schema.incidents)
    .set({ status: input.dismiss ? "dismissed" : "resolved", resolution: input.resolution.trim(), strikeIssued: strike, resolvedBy: actor.id, resolvedAt: Date.now() })
    .where(and(eq(schema.incidents.id, inc.id), eq(schema.incidents.status, "open")))
    .returning({ id: schema.incidents.id });
  if (!claimed.length) throw new WorkflowError("Someone else closed this incident a moment ago.");
  await audit({
    actorId: actor.id,
    action: input.dismiss ? "incident.dismissed" : "incident.resolved",
    entityType: "incident",
    entityId: inc.id,
    bookingId: inc.bookingId,
    details: { resolution: input.resolution, strike, borrowerResponded: statements.some((s) => s.role === "borrower"), statements: statements.length, readBothSides: Boolean(input.readBothSides) },
  });
  if (inc.subjectUserId) {
    await notify(
      inc.subjectUserId,
      "incident",
      `Incident ${input.dismiss ? "dismissed" : "resolved"}: ${r.name}`,
      `${input.resolution.trim()}${strike ? " If you disagree, you can appeal to an administrator from the incident page." : ""}`,
      `/incidents/${inc.id}`,
    );
  }
  if (r.ownerId !== actor.id && r.ownerId !== inc.subjectUserId)
    await notify(r.ownerId, "incident", `Incident ${input.dismiss ? "dismissed" : "resolved"}: ${r.name}`, input.resolution.trim(), `/incidents/${inc.id}`);
  if (strike && inc.subjectUserId) await addStrike(actor, inc.subjectUserId, `Incident on ${r.name}: ${input.resolution.trim()}`);
}

export async function addStrike(actor: User, userId: string, reason: string) {
  const u = (await db.query.users.findFirst({ where: eq(schema.users.id, userId) }))!;
  const strikes = u.strikes + 1;
  const suspend = strikes >= STRIKE_LIMIT;
  await db.update(schema.users).set({ strikes, suspended: u.suspended || suspend }).where(eq(schema.users.id, userId));
  await audit({ actorId: actor.id, action: "user.strike", entityType: "user", entityId: userId, details: { reason, strikes } });
  await notify(userId, "strike", `Strike ${strikes} of ${STRIKE_LIMIT}`, reason, "/profile");
  if (suspend && !u.suspended) {
    await audit({ actorId: actor.id, action: "user.suspended", entityType: "user", entityId: userId, details: { reason: `Reached ${STRIKE_LIMIT} strikes` } });
    await notify(userId, "strike", "Booking privileges suspended", `You reached ${STRIKE_LIMIT} strikes. An administrator will review your account.`, "/profile");
  }
}

// ---------------------------------------------------------------- time-based sweep

let lastSweep = 0;

/** Reminders, overdue flags and no-shows. Runs lazily on page loads (at most once a minute) and from the cron route. */
export async function sweep(force = false) {
  const now = Date.now();
  if (!force && now - lastSweep < 60_000) return;
  lastSweep = now;

  // Allocation rounds whose closing time has passed: reveal the seed and draw.
  await drawDueRounds(now);

  const upcoming = await db
    .select()
    .from(T)
    .where(and(eq(T.status, "approved"), isNull(T.remindedAt), lt(T.start, now + 24 * HOUR), gt(T.start, now)));
  for (const b of upcoming) {
    const r = await db.query.resources.findFirst({ where: eq(schema.resources.id, b.resourceId) });
    await db.update(T).set({ remindedAt: now }).where(eq(T.id, b.id));
    await notify(b.userId, "reminder", `Reminder: ${r?.name} soon`, `Your slot is ${fmtRange(b.start, b.end)}. Bring your ID${r?.supervisionRequired ? "; staff will supervise check-in" : ""}.`, `/bookings/${b.id}`);
    await audit({ actorId: null, action: "booking.reminder", entityType: "booking", entityId: b.id });
  }

  const overdue = await db.select().from(T).where(and(eq(T.status, "checked_out"), isNull(T.overdueNotifiedAt), lt(T.end, now)));
  for (const b of overdue) {
    const r = (await db.query.resources.findFirst({ where: eq(schema.resources.id, b.resourceId) }))!;
    await db.update(T).set({ overdueNotifiedAt: now }).where(eq(T.id, b.id));
    await audit({ actorId: null, action: "booking.overdue", entityType: "booking", entityId: b.id, details: { dueAt: b.end } });
    await notify(b.userId, "overdue", `Overdue: please return ${r.name}`, `It was due at ${fmtRange(b.start, b.end)}. Return it or request an extension.`, `/bookings/${b.id}`);
    await notify(r.ownerId, "overdue", `Overdue: ${r.name}`, `Not yet returned (due ${fmtRange(b.start, b.end)}).`, `/bookings/${b.id}`);
  }

  if (!demoMode()) {
    const noShows = await db.select().from(T).where(and(eq(T.status, "approved"), lt(T.end, now)));
    for (const b of noShows) {
      const r = (await db.query.resources.findFirst({ where: eq(schema.resources.id, b.resourceId) }))!;
      await db.update(T).set({ status: "closed", decisionReason: "No-show: the slot ended without a check-in." }).where(eq(T.id, b.id));
      await audit({ actorId: null, action: "booking.no_show", entityType: "booking", entityId: b.id });
      await notify(b.userId, "no_show", `Missed booking: ${r.name}`, "Recorded as a no-show. Repeated no-shows lower your priority for busy resources.", `/bookings/${b.id}`);
    }
  }
}

export function isOverdue(b: Pick<Booking, "status" | "end">, now = Date.now()) {
  return b.status === "checked_out" && b.end < now;
}

export { ref as refOf };
