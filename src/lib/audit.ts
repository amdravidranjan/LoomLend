import "server-only";
import { createHash } from "node:crypto";
import { asc, desc } from "drizzle-orm";
import { db, schema } from "@/db";

const GENESIS = "0".repeat(64);

type AuditInput = {
  actorId: string | null; // null = system rule
  action: string;
  entityType: "booking" | "resource" | "user" | "certification" | "incident" | "system";
  entityId: string;
  bookingId?: string | null;
  details?: Record<string, unknown>;
  at?: number; // only the seed script backdates entries
};

function digest(prevHash: string, e: { actorId: string | null; action: string; entityType: string; entityId: string; details: string; createdAt: number }) {
  return createHash("sha256")
    .update([prevHash, e.actorId ?? "system", e.action, e.entityType, e.entityId, e.details, e.createdAt].join("|"))
    .digest("hex");
}

/** Append an entry to the hash-chained activity history. Entries are never updated or deleted. */
export async function audit(input: AuditInput) {
  const last = await db.select({ hash: schema.auditLog.hash }).from(schema.auditLog).orderBy(desc(schema.auditLog.seq)).limit(1);
  const prevHash = last[0]?.hash ?? GENESIS;
  const createdAt = input.at ?? Date.now();
  const details = JSON.stringify(input.details ?? {});
  const hash = digest(prevHash, { ...input, details, createdAt });
  await db.insert(schema.auditLog).values({
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    bookingId: input.bookingId ?? (input.entityType === "booking" ? input.entityId : null),
    details,
    prevHash,
    hash,
    createdAt,
  });
}

/** Recompute the chain; returns the first broken sequence number, if any. */
export async function verifyAuditChain() {
  const rows = await db.select().from(schema.auditLog).orderBy(asc(schema.auditLog.seq));
  let prev = GENESIS;
  for (const r of rows) {
    const expected = digest(prev, r);
    if (r.prevHash !== prev || r.hash !== expected) return { ok: false as const, brokenAt: r.seq, total: rows.length };
    prev = r.hash;
  }
  return { ok: true as const, total: rows.length, head: prev };
}

export const ACTION_LABEL: Record<string, string> = {
  "resource.listed": "Listed resource",
  "resource.updated": "Updated listing",
  "resource.status": "Changed resource status",
  "booking.requested": "Requested booking",
  "booking.auto_approved": "Auto-approved (owner rule)",
  "booking.approved": "Approved request",
  "booking.rejected": "Rejected request",
  "booking.waitlisted": "Placed on waiting list",
  "booking.promoted": "Moved up from waiting list",
  "booking.cancelled": "Cancelled booking",
  "booking.extended": "Extended booking",
  "booking.extension_denied": "Extension refused",
  "booking.checked_out": "Checked in / picked up",
  "booking.returned": "Returned resource",
  "booking.return_confirmed": "Confirmed return",
  "booking.overdue": "Flagged overdue",
  "booking.no_show": "Recorded no-show",
  "booking.reminder": "Sent reminder",
  "incident.reported": "Reported incident",
  "incident.resolved": "Resolved incident",
  "incident.dismissed": "Dismissed incident",
  "user.strike": "Issued strike",
  "user.suspended": "Suspended booking privileges",
  "user.reinstated": "Reinstated booking privileges",
  "user.id_verified": "Verified identity",
  "user.registered": "Registered account",
  "cert.submitted": "Submitted training record",
  "cert.verified": "Verified training record",
  "cert.rejected": "Rejected training record",
  "system.reset": "Reset demo data",
};
