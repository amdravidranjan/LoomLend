// Pure hand-over rules: proof-of-presence requirements, one-time staff codes and QR tag secrets.
// No database access here, so everything is unit-testable (tests/handover.test.ts).
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export type HandoverMethod = "qr" | "staff_code" | "staff_manual";
export type HandoverPurpose = "check_out" | "return";

export const CODE_TTL_MS = 5 * 60_000;
export const CODE_MAX_ATTEMPTS = 5;
export const CODE_LENGTH = 6;

export const METHOD_LABEL: Record<HandoverMethod, string> = {
  qr: "Verified at the machine via QR tag",
  staff_code: "Co-signed with a staff one-time code",
  staff_manual: "Recorded in person by staff",
};

export const METHOD_SHORT: Record<HandoverMethod, string> = {
  qr: "QR tag",
  staff_code: "Staff code",
  staff_manual: "Staff in person",
};

// ---------------------------------------------------------------- secrets

/** 144 random bits, URL-safe. Printed into the QR tag stuck on the item. */
export function newQrSecret() {
  return randomBytes(18).toString("base64url");
}

/** Constant-time string comparison. Hashing first equalises lengths so the length is not leaked either. */
export function safeEqual(a: string | null | undefined, b: string | null | undefined) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db);
}

const B32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid misreads

/** Short code printed under the QR for people who cannot scan: XXXX-XXXX-XXXX (60 bits). */
export function manualTagCode(resourceId: string, secret: string) {
  const d = createHash("sha256").update(`tag:${resourceId}:${secret}`).digest();
  let out = "";
  for (let i = 0; i < 12; i++) out += B32[d[i] % 32];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

export function normaliseManualCode(input: string) {
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").replace(/I/g, "1");
  return s.length === 12 ? `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}` : null;
}

export { parseTagPayload } from "./tag-url";

// ---------------------------------------------------------------- one-time staff codes

export function generateCode() {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

/** sha256 with a booking-specific salt: the same digits on another booking (or purpose) hash differently. */
export function hashCode(code: string, salt: { bookingId: string; purpose: HandoverPurpose; codeId: string }) {
  return createHash("sha256").update(`loomlend-handover|${salt.bookingId}|${salt.purpose}|${salt.codeId}|${code}`).digest("hex");
}

export function normaliseCode(input: string) {
  const digits = input.replace(/\D/g, "");
  return digits.length === CODE_LENGTH ? digits : null;
}

export type CodeRow = {
  id: string;
  bookingId: string;
  purpose: HandoverPurpose;
  codeHash: string;
  attempts: number;
  expiresAt: number;
  usedAt: number | null;
};

export type CodeCheck =
  | { ok: true }
  | { ok: false; reason: "none" | "expired" | "used" | "locked" | "malformed" | "mismatch"; attemptsLeft: number };

/**
 * Decide whether `input` unlocks `row`. The caller must persist `attempts + 1` for every
 * outcome other than "none"/"used"/"expired"/"locked" (i.e. each real guess counts).
 */
export function checkCode(row: CodeRow | null | undefined, input: string, now: number): CodeCheck {
  if (!row) return { ok: false, reason: "none", attemptsLeft: 0 };
  if (row.usedAt) return { ok: false, reason: "used", attemptsLeft: 0 };
  if (row.expiresAt <= now) return { ok: false, reason: "expired", attemptsLeft: 0 };
  if (row.attempts >= CODE_MAX_ATTEMPTS) return { ok: false, reason: "locked", attemptsLeft: 0 };
  const left = CODE_MAX_ATTEMPTS - row.attempts - 1;
  const code = normaliseCode(input);
  if (!code) return { ok: false, reason: "malformed", attemptsLeft: left };
  const expected = hashCode(code, { bookingId: row.bookingId, purpose: row.purpose, codeId: row.id });
  return safeEqual(expected, row.codeHash) ? { ok: true } : { ok: false, reason: "mismatch", attemptsLeft: left };
}

export function codeErrorMessage(c: Exclude<CodeCheck, { ok: true }>) {
  switch (c.reason) {
    case "none":
      return "There is no active staff code for this hand-over. Ask the staff member to generate one on their phone.";
    case "expired":
      return "That staff code has expired (codes last 5 minutes). Ask the staff member for a fresh one.";
    case "used":
      return "That staff code was already used. Ask the staff member for a fresh one.";
    case "locked":
      return "Too many wrong attempts. That code is now blocked; ask the staff member for a new one.";
    case "malformed":
      return `Enter the ${CODE_LENGTH}-digit code the staff member shows you.${c.attemptsLeft > 0 ? ` ${c.attemptsLeft} attempt(s) left.` : ""}`;
    case "mismatch":
      return c.attemptsLeft > 0
        ? `That code does not match. ${c.attemptsLeft} attempt(s) left.`
        : "That code does not match and the code is now blocked. Ask the staff member for a new one.";
  }
}

// ---------------------------------------------------------------- proof requirements

export type ProofInput = {
  method: HandoverMethod;
  qrSecret?: string | null;
  code?: string | null;
  simulated?: boolean; // demo-only "simulate scanning the tag" button
};

export type ProofContext = {
  isBorrower: boolean;
  isStaff: boolean; // owner / department manager / admin for this resource
  supervised: boolean;
  demo: boolean;
};

/** Which proof methods are acceptable for this person on this resource. */
export function allowedMethods(ctx: ProofContext): HandoverMethod[] {
  const out: HandoverMethod[] = [];
  // Staff recording a hand-over they are physically part of.
  if (ctx.isStaff) out.push("staff_manual");
  if (ctx.isBorrower || ctx.isStaff) {
    // Supervised items: a QR scan alone does not prove staff were there.
    if (!ctx.supervised) out.push("qr");
    out.push("staff_code");
  }
  return out;
}

/** Returns an error message if the chosen method is not acceptable, otherwise null. */
export function proofRuleError(ctx: ProofContext, proof: ProofInput | null | undefined): string | null {
  if (!ctx.isBorrower && !ctx.isStaff) return "Only the borrower or the staff who manage this resource can record a hand-over.";
  if (!proof) return ctx.supervised
    ? "This item is supervised: ask the staff member for a one-time code, or they can record the hand-over with you."
    : "Scan the QR tag on the item (or enter a staff code) to prove you are at the machine.";
  if (proof.simulated && !ctx.demo) return "Simulated scans only work in demo mode. Scan the real tag on the item.";
  const allowed = allowedMethods(ctx);
  if (!allowed.includes(proof.method)) {
    if (proof.method === "qr" && ctx.supervised)
      return "This item is supervised, so scanning the tag is not enough. Ask the staff member for a one-time code, or they can record the hand-over with you.";
    if (proof.method === "staff_manual") return "Only staff can record a hand-over in person.";
    return "That proof method is not accepted here.";
  }
  if (proof.method === "qr" && !proof.qrSecret) return "Scan the QR tag on the item to continue.";
  if (proof.method === "staff_code" && !proof.code) return "Enter the 6-digit code the staff member shows you.";
  return null;
}

export const CHECK_IN_EARLY_MS = 30 * 60_000;

/** Whether a booking can be checked in at `now`. Demo mode lifts the time window. */
export function checkInWindow(b: { start: number; end: number }, now: number, demo: boolean): "open" | "early" | "ended" {
  if (demo) return "open";
  if (now < b.start - CHECK_IN_EARLY_MS) return "early";
  if (now > b.end) return "ended";
  return "open";
}

/** Photos are mandatory when money (deposit) or supervision is at stake. */
export function photoRequired(r: { depositRequired: number; supervisionRequired: boolean }) {
  return r.depositRequired > 0 || r.supervisionRequired;
}
