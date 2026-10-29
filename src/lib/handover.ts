import "server-only";
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Booking, Incident, IncidentStatement, Resource, User } from "@/db/schema";
import { audit } from "./audit";
import { notify } from "./notify";
import { canManageResource } from "./auth";
import { STRIKE_LIMIT } from "./catalog";
import { fmtRange } from "./time";
import { WorkflowError, bookingRef, demoMode } from "./workflow";
import {
  CODE_MAX_ATTEMPTS,
  CODE_TTL_MS,
  METHOD_LABEL,
  checkCode,
  checkInWindow,
  codeErrorMessage,
  generateCode,
  hashCode,
  manualTagCode,
  newQrSecret,
  normaliseManualCode,
  proofRuleError,
  safeEqual,
  type HandoverMethod,
  type HandoverPurpose,
  type ProofInput,
} from "./handover-rules";

// Physical hand-over: QR tags on the item, one-time staff codes, statements on incidents.
// Every function re-checks permissions on the server, audits and notifies.

const C = schema.handoverCodes;
const PURPOSE_LABEL: Record<HandoverPurpose, string> = { check_out: "check-in", return: "return" };

// ---------------------------------------------------------------- QR tags

/** The resource's tag secret, generated (and persisted) on first use. */
export async function ensureQrSecret(r: Pick<Resource, "id" | "qrSecret">) {
  if (r.qrSecret) return r.qrSecret;
  const secret = newQrSecret();
  // Only fill an empty secret: never clobber one another request just created.
  await db.update(schema.resources).set({ qrSecret: secret }).where(and(eq(schema.resources.id, r.id), eq(schema.resources.qrSecret, "")));
  const fresh = await db.query.resources.findFirst({ where: eq(schema.resources.id, r.id), columns: { qrSecret: true } });
  return fresh?.qrSecret || secret;
}

export function tagPath(resourceId: string, secret: string) {
  return `/scan/${encodeURIComponent(resourceId)}?k=${encodeURIComponent(secret)}`;
}

export async function rotateQrSecret(actor: User, resourceId: string) {
  const r = await db.query.resources.findFirst({ where: eq(schema.resources.id, resourceId) });
  if (!r) throw new WorkflowError("Resource not found.");
  if (!canManageResource(actor, r)) throw new WorkflowError("Only the owner or a manager can replace this tag.");
  const secret = newQrSecret();
  await db.update(schema.resources).set({ qrSecret: secret }).where(eq(schema.resources.id, r.id));
  await audit({ actorId: actor.id, action: "resource.tag_rotated", entityType: "resource", entityId: r.id, details: { resource: r.name, note: "Old printed tags stop working" } });
  if (actor.id !== r.ownerId) await notify(r.ownerId, "info", `QR tag replaced: ${r.name}`, `${actor.name} rotated the tag. Print and stick the new one; the old tag no longer works.`, `/resources/${r.id}/tag`);
  return secret;
}

/** Find the resource whose printed manual code matches (for people who cannot scan). */
export async function resourceByManualCode(input: string) {
  const code = normaliseManualCode(input);
  if (!code) return null;
  const rows = await db.select({ id: schema.resources.id, qrSecret: schema.resources.qrSecret }).from(schema.resources);
  for (const r of rows) {
    if (r.qrSecret && safeEqual(manualTagCode(r.id, r.qrSecret), code)) return { id: r.id, secret: r.qrSecret };
  }
  return null;
}

export function tagSecretMatches(r: Pick<Resource, "qrSecret">, k: string | null | undefined) {
  return Boolean(r.qrSecret) && safeEqual(r.qrSecret, k ?? "");
}

// ---------------------------------------------------------------- scanning

export type ScanTarget =
  | { kind: "check_out"; booking: Booking }
  | { kind: "return"; booking: Booking }
  | { kind: "early"; booking: Booking }
  | { kind: "taken"; until: number | null }
  | { kind: "none" };

/** What should the signed-in member do with this item right now? */
export async function scanTargetFor(user: User, r: Resource, now: number): Promise<ScanTarget> {
  const mine = await db
    .select()
    .from(schema.bookings)
    .where(and(eq(schema.bookings.resourceId, r.id), eq(schema.bookings.userId, user.id), inArray(schema.bookings.status, ["approved", "checked_out"])));
  const out = mine.find((b) => b.status === "checked_out");
  if (out) return { kind: "return", booking: out };
  const approved = mine.filter((b) => b.status === "approved" && (demoMode() || b.end >= now)).sort((a, b) => a.start - b.start);
  const open = approved.find((b) => checkInWindow(b, now, demoMode()) === "open");
  if (open) return { kind: "check_out", booking: open };
  if (approved[0]) return { kind: "early", booking: approved[0] };
  // Someone else has it in hand, or holds the slot happening now.
  const others = await db
    .select()
    .from(schema.bookings)
    .where(and(eq(schema.bookings.resourceId, r.id), inArray(schema.bookings.status, ["approved", "checked_out"])));
  const inUse = others.find((b) => b.status === "checked_out") ?? others.find((b) => b.start <= now + 30 * 60_000 && b.end >= now);
  return inUse ? { kind: "taken", until: inUse.end } : { kind: "none" };
}

/** Staff at the item: everything in progress or ready for hand-over on it. */
export async function activeBookingsOn(resourceId: string) {
  const rows = await db
    .select()
    .from(schema.bookings)
    .where(and(eq(schema.bookings.resourceId, resourceId), inArray(schema.bookings.status, ["approved", "checked_out"])));
  return rows.sort((a, b) => (a.status === b.status ? a.start - b.start : a.status === "checked_out" ? -1 : 1));
}

// ---------------------------------------------------------------- one-time staff codes

/** Staff generates a 6-digit code bound to one booking + purpose. Returned once; only its hash is stored. */
export async function issueHandoverCode(actor: User, bookingId: string, purpose: HandoverPurpose) {
  const b = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, bookingId) });
  if (!b) throw new WorkflowError("Booking not found.");
  const r = (await db.query.resources.findFirst({ where: eq(schema.resources.id, b.resourceId) }))!;
  if (!canManageResource(actor, r)) throw new WorkflowError("Only the owner or a manager of this resource can issue hand-over codes.");
  const expected = purpose === "check_out" ? "approved" : "checked_out";
  if (b.status !== expected)
    throw new WorkflowError(purpose === "check_out" ? "This booking is not ready for check-in." : "This booking is not checked out, so there is nothing to return.");
  const now = Date.now();
  const recent = await db.select({ id: C.id }).from(C).where(and(eq(C.bookingId, b.id), gt(C.createdAt, now - 10 * 60_000)));
  if (recent.length >= 6) throw new WorkflowError("Too many codes in the last 10 minutes. Wait a moment, or record the hand-over in person instead.");

  // Only one live code per booking + purpose: older ones stop working.
  await db.update(C).set({ expiresAt: now }).where(and(eq(C.bookingId, b.id), eq(C.purpose, purpose), isNull(C.usedAt), gt(C.expiresAt, now)));
  const id = crypto.randomUUID();
  const code = generateCode();
  const expiresAt = now + CODE_TTL_MS;
  await db.insert(C).values({ id, bookingId: b.id, staffId: actor.id, purpose, codeHash: hashCode(code, { bookingId: b.id, purpose, codeId: id }), attempts: 0, expiresAt, createdAt: now });
  await audit({ actorId: actor.id, action: "handover.code_issued", entityType: "booking", entityId: b.id, details: { purpose: PURPOSE_LABEL[purpose], validMinutes: CODE_TTL_MS / 60_000 } });
  await notify(b.userId, "info", `Staff code ready for your ${PURPOSE_LABEL[purpose]}`, `${actor.name} generated a one-time code for ${r.name}. Enter it on your booking page within 5 minutes.`, `/bookings/${b.id}`);
  return { code, expiresAt };
}

/** The currently live code (without the digits), so staff see that one is pending after a reload. */
export async function liveCode(bookingId: string, purpose: HandoverPurpose, now: number) {
  return db.query.handoverCodes.findFirst({
    where: and(eq(C.bookingId, bookingId), eq(C.purpose, purpose), isNull(C.usedAt), gt(C.expiresAt, now)),
    orderBy: desc(C.createdAt),
  });
}

async function consumeCode(actor: User, b: Booking, r: Resource, purpose: HandoverPurpose, input: string, now: number) {
  const row = await db.query.handoverCodes.findFirst({ where: and(eq(C.bookingId, b.id), eq(C.purpose, purpose)), orderBy: desc(C.createdAt) });
  const verdict = checkCode(row, input, now);
  if (verdict.ok) {
    // Single use even under concurrent submissions: only one UPDATE can flip usedAt.
    const claimed = await db
      .update(C)
      .set({ usedAt: now, attempts: row!.attempts + 1 })
      .where(and(eq(C.id, row!.id), isNull(C.usedAt)))
      .returning({ id: C.id });
    if (!claimed.length) throw new WorkflowError(codeErrorMessage({ ok: false, reason: "used", attemptsLeft: 0 }));
    return row!.staffId;
  }
  if (row && (verdict.reason === "mismatch" || verdict.reason === "malformed")) {
    await db.update(C).set({ attempts: row.attempts + 1 }).where(eq(C.id, row.id));
    if (verdict.attemptsLeft === 0)
      await notify(row.staffId, "info", `Hand-over code blocked: ${r.name}`, `${CODE_MAX_ATTEMPTS} wrong attempts on ${bookingRef(b.id)}. Generate a new code if the borrower is with you.`, `/bookings/${b.id}`);
  }
  // Never log the code itself.
  await audit({ actorId: actor.id, action: "handover.code_failed", entityType: "booking", entityId: b.id, details: { purpose: PURPOSE_LABEL[purpose], reason: verdict.reason, attemptsLeft: verdict.attemptsLeft } });
  throw new WorkflowError(codeErrorMessage(verdict));
}

export type VerifiedProof = { method: HandoverMethod; coSignerId: string | null; simulated: boolean; label: string };

/**
 * Prove the person is at the item. Called by checkOut / returnResource after every other
 * check passed, so a staff code is only consumed when the hand-over will actually be recorded.
 */
export async function verifyHandoverProof(actor: User, b: Booking, r: Resource, purpose: HandoverPurpose, proof: ProofInput | null | undefined): Promise<VerifiedProof> {
  const ctx = { isBorrower: b.userId === actor.id, isStaff: canManageResource(actor, r), supervised: r.supervisionRequired, demo: demoMode() };
  const ruleErr = proofRuleError(ctx, proof);
  if (ruleErr) throw new WorkflowError(ruleErr);
  const p = proof!;
  if (p.method === "qr") {
    const secret = await ensureQrSecret(r);
    if (!safeEqual(secret, p.qrSecret ?? "")) {
      await audit({ actorId: actor.id, action: "handover.tag_rejected", entityType: "booking", entityId: b.id, details: { purpose: PURPOSE_LABEL[purpose], reason: "tag secret did not match (old or foreign tag)" } });
      throw new WorkflowError("This QR tag is not valid for this item. It may be an old tag that was replaced. Scan the tag on the item itself, or ask staff for a one-time code.");
    }
    return { method: "qr", coSignerId: null, simulated: Boolean(p.simulated), label: p.simulated ? `${METHOD_LABEL.qr} (simulated in demo mode)` : METHOD_LABEL.qr };
  }
  if (p.method === "staff_code") {
    const staffId = await consumeCode(actor, b, r, purpose, p.code ?? "", Date.now());
    return { method: "staff_code", coSignerId: staffId, simulated: false, label: METHOD_LABEL.staff_code };
  }
  return { method: "staff_manual", coSignerId: actor.id, simulated: false, label: METHOD_LABEL.staff_manual };
}

/**
 * Read the proof fields a hand-over form submitted. "qr_demo" is the demo-mode "simulate scanning
 * the tag" button: the server itself supplies the real secret, so the rest of the path is identical.
 */
export async function proofFromForm(fd: FormData, bookingId: string): Promise<ProofInput | null> {
  const method = String(fd.get("method") ?? "");
  if (method === "qr") return { method: "qr", qrSecret: String(fd.get("k") ?? "") };
  if (method === "staff_code") return { method: "staff_code", code: String(fd.get("code") ?? "") };
  if (method === "staff_manual") return { method: "staff_manual" };
  if (method === "qr_demo") {
    if (!demoMode()) throw new WorkflowError("Simulated scans only work in demo mode. Scan the real tag on the item.");
    const b = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, bookingId) });
    const r = b ? await db.query.resources.findFirst({ where: eq(schema.resources.id, b.resourceId) }) : null;
    if (!r) throw new WorkflowError("Booking not found.");
    return { method: "qr", qrSecret: await ensureQrSecret(r), simulated: true };
  }
  return null;
}

// ---------------------------------------------------------------- two-sided incidents

export type StatementRole = IncidentStatement["role"];

export function statementRole(user: User, inc: Pick<Incident, "subjectUserId" | "reporterId">, r: Pick<Resource, "ownerId" | "department">): StatementRole | null {
  if (inc.subjectUserId === user.id) return "borrower";
  if (r.ownerId === user.id) return "owner";
  if (user.role === "admin" || (user.role === "manager" && r.department === user.department)) return "manager";
  if (inc.reporterId === user.id) return "witness";
  return null;
}

async function incidentParties(inc: Incident, r: Resource) {
  const managers = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.role, "manager"), eq(schema.users.department, r.department)));
  return [...new Set([inc.subjectUserId, r.ownerId, inc.reporterId, ...managers.map((m) => m.id)].filter((x): x is string => Boolean(x) && x !== "system"))];
}

function checkPhoto(photo: string | null | undefined) {
  if (!photo) return null;
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(photo) || photo.length > 1_500_000) throw new WorkflowError("Photo is invalid or too large.");
  return photo;
}

export async function addIncidentStatement(actor: User, incidentId: string, input: { body: string; photo?: string | null }) {
  const inc = await db.query.incidents.findFirst({ where: eq(schema.incidents.id, incidentId) });
  if (!inc) throw new WorkflowError("Incident not found.");
  const r = (await db.query.resources.findFirst({ where: eq(schema.resources.id, inc.resourceId) }))!;
  const role = statementRole(actor, inc, r);
  if (!role) throw new WorkflowError("Only the people involved (borrower, owner, manager) can add a statement.");
  if (inc.status !== "open") throw new WorkflowError("This incident is closed. If you are the borrower and disagree with the outcome, use the appeal option.");
  const body = input.body.trim();
  if (body.length < 10) throw new WorkflowError("Write at least a sentence (10 characters) explaining your side.");
  if (body.length > 2000) throw new WorkflowError("Keep your statement under 2000 characters.");
  const photo = checkPhoto(input.photo);
  const mine = await db.select({ id: schema.incidentStatements.id }).from(schema.incidentStatements).where(and(eq(schema.incidentStatements.incidentId, inc.id), eq(schema.incidentStatements.userId, actor.id)));
  if (mine.length >= 10) throw new WorkflowError("You have already added 10 statements. The manager will decide from what is on record.");
  const id = crypto.randomUUID();
  await db.insert(schema.incidentStatements).values({ id, incidentId: inc.id, userId: actor.id, role, body, photo, createdAt: Date.now() });
  await audit({ actorId: actor.id, action: "incident.statement", entityType: "incident", entityId: inc.id, bookingId: inc.bookingId, details: { role, photo: Boolean(photo), chars: body.length } });
  for (const uid of await incidentParties(inc, r)) {
    if (uid === actor.id) continue;
    await notify(uid, "incident", `New statement on the ${r.name} incident`, `${actor.name} (${role}) added their side.`, `/incidents/${inc.id}`);
  }
  return id;
}

/** The borrower disagrees with a decision: an administrator reviews it. */
export async function appealIncident(actor: User, incidentId: string, reason: string) {
  const inc = await db.query.incidents.findFirst({ where: eq(schema.incidents.id, incidentId) });
  if (!inc) throw new WorkflowError("Incident not found.");
  if (inc.subjectUserId !== actor.id) throw new WorkflowError("Only the borrower named in the incident can appeal.");
  if (inc.status !== "resolved") throw new WorkflowError(inc.status === "open" ? "Add your side now; you can appeal after a decision is made." : "A dismissed incident has no penalty to appeal.");
  if (await appealState(inc.id)) throw new WorkflowError("You have already appealed this decision.");
  const body = reason.trim();
  if (body.length < 20) throw new WorkflowError("Explain why the decision should be reviewed (at least 20 characters).");
  const r = (await db.query.resources.findFirst({ where: eq(schema.resources.id, inc.resourceId) }))!;
  await db.insert(schema.incidentStatements).values({ id: crypto.randomUUID(), incidentId: inc.id, userId: actor.id, role: "borrower", body: `Appeal: ${body.slice(0, 2000)}`, createdAt: Date.now() });
  await audit({ actorId: actor.id, action: "incident.appealed", entityType: "incident", entityId: inc.id, bookingId: inc.bookingId, details: { strikeUnderAppeal: inc.strikeIssued } });
  const admins = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.role, "admin"));
  for (const a of admins) await notify(a.id, "review", `Appeal to review: ${r.name} incident`, `${actor.name} appealed the decision${inc.strikeIssued ? " and the strike" : ""}.`, `/incidents/${inc.id}`);
  if (inc.resolvedBy) await notify(inc.resolvedBy, "info", `Your decision was appealed`, `${actor.name} asked an administrator to review the ${r.name} incident.`, `/incidents/${inc.id}`);
}

/** null = no appeal; "pending" = waiting for an admin; otherwise the admin's verdict. */
export async function appealState(incidentId: string): Promise<null | "pending" | "upheld" | "overturned"> {
  const rows = await db
    .select()
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.entityId, incidentId), inArray(schema.auditLog.action, ["incident.appealed", "incident.appeal_decided"])));
  if (!rows.length) return null;
  const decided = rows.find((r) => r.action === "incident.appeal_decided");
  if (!decided) return "pending";
  try {
    return (JSON.parse(decided.details) as { verdict: "upheld" | "overturned" }).verdict;
  } catch {
    return "upheld";
  }
}

export async function decideAppeal(actor: User, incidentId: string, verdict: "upheld" | "overturned", note: string) {
  if (actor.role !== "admin") throw new WorkflowError("Appeals are reviewed by an administrator.");
  const inc = await db.query.incidents.findFirst({ where: eq(schema.incidents.id, incidentId) });
  if (!inc) throw new WorkflowError("Incident not found.");
  if ((await appealState(inc.id)) !== "pending") throw new WorkflowError("There is no pending appeal on this incident.");
  if (note.trim().length < 10) throw new WorkflowError("Explain the appeal decision (at least 10 characters). It is shown to the borrower.");
  const r = (await db.query.resources.findFirst({ where: eq(schema.resources.id, inc.resourceId) }))!;
  let strikeRemoved = false;
  if (verdict === "overturned" && inc.strikeIssued && inc.subjectUserId) {
    const u = await db.query.users.findFirst({ where: eq(schema.users.id, inc.subjectUserId) });
    if (u) {
      const strikes = Math.max(0, u.strikes - 1);
      await db.update(schema.users).set({ strikes, suspended: u.suspended && strikes >= STRIKE_LIMIT }).where(eq(schema.users.id, u.id));
      await db.update(schema.incidents).set({ strikeIssued: false }).where(eq(schema.incidents.id, inc.id));
      strikeRemoved = true;
      await audit({ actorId: actor.id, action: "user.strike_removed", entityType: "user", entityId: u.id, details: { reason: `Appeal upheld for the ${r.name} incident`, strikes } });
    }
  }
  await audit({ actorId: actor.id, action: "incident.appeal_decided", entityType: "incident", entityId: inc.id, bookingId: inc.bookingId, details: { verdict, note: note.trim(), strikeRemoved, reviewedOwnDecision: inc.resolvedBy === actor.id } });
  if (inc.subjectUserId)
    await notify(inc.subjectUserId, verdict === "overturned" ? "approved" : "info", `Appeal ${verdict === "overturned" ? "accepted" : "not accepted"}: ${r.name}`, `${note.trim()}${strikeRemoved ? " The strike was removed." : ""}`, `/incidents/${inc.id}`);
}

/** When the borrower was first told about this incident (for "hasn't responded in X" reminders). */
export async function borrowerNotifiedAt(inc: Incident) {
  if (!inc.subjectUserId) return null;
  const n = await db.query.notifications.findFirst({
    where: and(eq(schema.notifications.userId, inc.subjectUserId), eq(schema.notifications.link, `/incidents/${inc.id}`)),
    orderBy: schema.notifications.createdAt,
  });
  return n?.createdAt ?? inc.createdAt;
}

export function slotText(b: Pick<Booking, "start" | "end">) {
  return fmtRange(b.start, b.end);
}
