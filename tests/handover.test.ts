import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CODE_MAX_ATTEMPTS,
  CODE_TTL_MS,
  allowedMethods,
  checkCode,
  checkInWindow,
  codeErrorMessage,
  generateCode,
  hashCode,
  manualTagCode,
  newQrSecret,
  normaliseCode,
  normaliseManualCode,
  photoRequired,
  proofRuleError,
  safeEqual,
  type CodeRow,
  type ProofContext,
} from "../src/lib/handover-rules";
import { parseTagPayload, tagHref } from "../src/lib/tag-url";

const NOW = 1_800_000_000_000;

function row(code: string, o: Partial<CodeRow> = {}): CodeRow {
  const base = { id: "code-1", bookingId: "b1", purpose: "check_out" as const, attempts: 0, expiresAt: NOW + CODE_TTL_MS, usedAt: null, ...o };
  return { ...base, codeHash: hashCode(code, { bookingId: base.bookingId, purpose: base.purpose, codeId: base.id }) };
}

// ---------------------------------------------------------------- codes

test("generated codes are 6 digits, zero-padded and varied", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const c = generateCode();
    assert.match(c, /^\d{6}$/);
    seen.add(c);
  }
  assert.ok(seen.size > 450, "codes should not repeat often");
});

test("code hash is salted per booking, purpose and code row", () => {
  const h = hashCode("123456", { bookingId: "b1", purpose: "check_out", codeId: "x" });
  assert.notEqual(h, hashCode("123456", { bookingId: "b2", purpose: "check_out", codeId: "x" }));
  assert.notEqual(h, hashCode("123456", { bookingId: "b1", purpose: "return", codeId: "x" }));
  assert.notEqual(h, hashCode("123456", { bookingId: "b1", purpose: "check_out", codeId: "y" }));
  assert.ok(!h.includes("123456"));
});

test("correct code within 5 minutes is accepted, spaces tolerated", () => {
  assert.deepEqual(checkCode(row("042917"), "042917", NOW), { ok: true });
  assert.deepEqual(checkCode(row("042917"), "042 917", NOW), { ok: true });
});

test("wrong code reports attempts left; the last wrong attempt locks", () => {
  const r = checkCode(row("111111"), "222222", NOW);
  assert.deepEqual(r, { ok: false, reason: "mismatch", attemptsLeft: CODE_MAX_ATTEMPTS - 1 });
  const last = checkCode(row("111111", { attempts: CODE_MAX_ATTEMPTS - 1 }), "222222", NOW);
  assert.equal(!last.ok && last.attemptsLeft, 0);
  assert.match(codeErrorMessage(last as Exclude<typeof last, { ok: true }>), /blocked/);
});

test("after max attempts even the right code is refused", () => {
  const r = checkCode(row("111111", { attempts: CODE_MAX_ATTEMPTS }), "111111", NOW);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, "locked");
});

test("expired codes are refused (boundary included)", () => {
  assert.equal(checkCode(row("111111", { expiresAt: NOW }), "111111", NOW).ok, false);
  const r = checkCode(row("111111", { expiresAt: NOW - 1 }), "111111", NOW);
  assert.equal(!r.ok && r.reason, "expired");
  assert.equal(checkCode(row("111111", { expiresAt: NOW + 1 }), "111111", NOW).ok, true);
});

test("codes are single use", () => {
  const r = checkCode(row("111111", { usedAt: NOW - 1000 }), "111111", NOW);
  assert.equal(!r.ok && r.reason, "used");
});

test("a code for another booking or purpose does not work here", () => {
  const forOther = row("111111", { bookingId: "other" });
  assert.equal(checkCode({ ...forOther, bookingId: "b1" }, "111111", NOW).ok, false);
  const forReturn = row("111111", { purpose: "return" });
  assert.equal(checkCode({ ...forReturn, purpose: "check_out" }, "111111", NOW).ok, false);
});

test("no code, or malformed input, is handled without counting as success", () => {
  assert.equal(checkCode(null, "111111", NOW).ok, false);
  const r = checkCode(row("111111"), "12ab", NOW);
  assert.equal(!r.ok && r.reason, "malformed");
  assert.equal(normaliseCode(" 12-34 56 "), "123456");
  assert.equal(normaliseCode("12345"), null);
});

test("constant-time compare: equal strings only, any length, never throws", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false); // different lengths do not throw
  assert.equal(safeEqual("", ""), false); // an empty secret never matches
  assert.equal(safeEqual(null, "x"), false);
  assert.equal(safeEqual(undefined, undefined), false);
});

// ---------------------------------------------------------------- tags

test("QR secrets are long and unique; manual codes are stable and readable", () => {
  const a = newQrSecret();
  assert.match(a, /^[A-Za-z0-9_-]{24}$/);
  assert.notEqual(a, newQrSecret());
  const m = manualTagCode("r-laser", a);
  assert.match(m, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(m, manualTagCode("r-laser", a));
  assert.notEqual(m, manualTagCode("r-laser", newQrSecret()), "rotating the secret changes the manual code");
  assert.equal(normaliseManualCode(m.toLowerCase().replace(/-/g, " ")), m);
  assert.equal(normaliseManualCode("short"), null);
});

test("tag URLs parse from absolute or relative URLs and reject anything else", () => {
  const s = newQrSecret();
  assert.deepEqual(parseTagPayload(`https://loomlend.vercel.app/scan/r-camera?k=${s}`), { resourceId: "r-camera", secret: s });
  assert.deepEqual(parseTagPayload(tagHref({ resourceId: "r-camera", secret: s })), { resourceId: "r-camera", secret: s });
  assert.equal(parseTagPayload("https://example.com/other?k=abc"), null);
  assert.equal(parseTagPayload("/scan/r-camera"), null);
  assert.equal(parseTagPayload("WIFI:S:campus;T:WPA;P:secret;;"), null);
  assert.equal(parseTagPayload(`/scan/r-camera?k=<script>`), null);
});

// ---------------------------------------------------------------- proof rules

const ctx = (o: Partial<ProofContext>): ProofContext => ({ isBorrower: true, isStaff: false, supervised: false, demo: false, ...o });

test("self-service items: borrower may use the QR tag or a staff code, not a manual staff entry", () => {
  assert.deepEqual(allowedMethods(ctx({})), ["qr", "staff_code"]);
  assert.equal(proofRuleError(ctx({}), { method: "qr", qrSecret: "s" }), null);
  assert.equal(proofRuleError(ctx({}), { method: "staff_code", code: "123456" }), null);
  assert.match(proofRuleError(ctx({}), { method: "staff_manual" })!, /Only staff/);
});

test("with demo mode off, a hand-over needs proof", () => {
  assert.match(proofRuleError(ctx({}), null)!, /Scan the QR tag/);
  assert.match(proofRuleError(ctx({}), { method: "qr" })!, /Scan the QR tag/);
  assert.match(proofRuleError(ctx({}), { method: "staff_code" })!, /6-digit/);
});

test("supervised items: QR alone is not enough; staff code or staff in person", () => {
  const c = ctx({ supervised: true });
  assert.deepEqual(allowedMethods(c), ["staff_code"]);
  assert.match(proofRuleError(c, { method: "qr", qrSecret: "s" })!, /supervised/);
  assert.equal(proofRuleError(c, { method: "staff_code", code: "123456" }), null);
  const staff = ctx({ isBorrower: false, isStaff: true, supervised: true });
  assert.equal(proofRuleError(staff, { method: "staff_manual" }), null);
});

test("simulated scans only in demo mode", () => {
  assert.match(proofRuleError(ctx({ demo: false }), { method: "qr", qrSecret: "s", simulated: true })!, /demo mode/);
  assert.equal(proofRuleError(ctx({ demo: true }), { method: "qr", qrSecret: "s", simulated: true }), null);
  // Demo mode never relaxes supervision.
  assert.notEqual(proofRuleError(ctx({ demo: true, supervised: true }), { method: "qr", qrSecret: "s", simulated: true }), null);
});

test("strangers cannot record a hand-over", () => {
  assert.match(proofRuleError(ctx({ isBorrower: false, isStaff: false }), { method: "qr", qrSecret: "s" })!, /Only the borrower/);
});

test("check-in window: 30 minutes early until the end, relaxed in demo mode", () => {
  const b = { start: NOW, end: NOW + 2 * 3_600_000 };
  assert.equal(checkInWindow(b, NOW - 31 * 60_000, false), "early");
  assert.equal(checkInWindow(b, NOW - 30 * 60_000, false), "open");
  assert.equal(checkInWindow(b, b.end, false), "open");
  assert.equal(checkInWindow(b, b.end + 1, false), "ended");
  assert.equal(checkInWindow(b, NOW - 5 * 86_400_000, true), "open");
});

test("photos are required when a deposit or supervision applies", () => {
  assert.equal(photoRequired({ depositRequired: 0, supervisionRequired: false }), false);
  assert.equal(photoRequired({ depositRequired: 2000, supervisionRequired: false }), true);
  assert.equal(photoRequired({ depositRequired: 0, supervisionRequired: true }), true);
});
