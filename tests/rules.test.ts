import { test } from "node:test";
import assert from "node:assert/strict";
import type { Booking, Certification, Resource, User } from "../src/db/schema";
import { overlaps, priorityScore, profileChecks, windowChecks, weeklyHours } from "../src/lib/rules";
import { matchResources } from "../src/lib/match";
import { campusDayAt, parseCampusLocal } from "../src/lib/time";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// A fixed Monday 08:00 IST so tests do not depend on today's date.
const NOW = parseCampusLocal("2026-11-02T08:00")!;
const at = (h: number, dayOffset = 0) => campusDayAt(NOW + dayOffset * DAY, h);

const user = (o: Partial<User> = {}): User => ({
  id: "u1", name: "Test", email: "t@x", passwordHash: "", role: "member", department: "ECE", affiliation: "student",
  idVerified: true, strikes: 0, suspended: false, createdAt: 0, ...o,
});
const resource = (o: Partial<Resource> = {}): Resource => ({
  id: "r1", ownerId: "o1", name: "Laser Cutter", category: "equipment", description: "laser cutter", location: "M-104", department: "Mechanical",
  emoji: "🔥", tags: "laser,cut,acrylic", requiredCerts: '["laser-cutter"]', requiresIdVerified: true, allowedAffiliations: '["student","staff"]',
  supervisionRequired: true, depositRequired: 0, openHour: 10, closeHour: 17, openDays: "[1,2,3,4,5]", maxHours: 2, weeklyHourCap: 4,
  usageRules: "rules", autoApprove: false, status: "active", qrSecret: "s", marketRatePerHour: 0, purchaseValue: 0,
  allocationMode: "review", roundLeadHours: 24, createdAt: 0, ...o,
});
const cert = (status: Certification["status"]): Certification => ({
  id: "c1", userId: "u1", certKey: "laser-cutter", evidence: "x", status, reviewedBy: null, reviewNote: null, createdAt: 0, reviewedAt: null,
});
const booking = (o: Partial<Booking>): Booking => ({
  id: crypto.randomUUID(), resourceId: "r1", userId: "u1", start: at(10), end: at(12), purpose: "p", purposeType: "coursework", status: "approved",
  decisionReason: null, decidedBy: null, eligibilitySnapshot: "{}", priorityScore: 0, priorityBreakdown: "[]", aiReview: null,
  checkOutAt: null, checkOutCondition: null, checkOutNotes: null, checkOutPhoto: null, returnAt: null, returnCondition: null, returnNotes: null,
  returnPhoto: null, returnConfirmedBy: null, remindedAt: null, overdueNotifiedAt: null, checkOutMethod: null, returnMethod: null,
  aiConditionDiff: null, roundId: null, createdAt: 0, ...o,
});
const failing = (checks: { key: string; pass: boolean }[]) => checks.filter((c) => !c.pass).map((c) => c.key);

test("verified training unlocks the resource; pending does not", () => {
  assert.deepEqual(failing(profileChecks(user(), resource(), [cert("verified")])), []);
  assert.deepEqual(failing(profileChecks(user(), resource(), [cert("pending")])), ["cert:laser-cutter"]);
});

test("unverified identity, wrong affiliation, suspension and maintenance all block", () => {
  const f = failing(profileChecks(user({ idVerified: false, affiliation: "external", suspended: true }), resource({ status: "maintenance" }), [cert("verified")]));
  assert.deepEqual(f.sort(), ["affiliation", "identity", "resource", "standing"]);
});

test("slot must be within opening hours, same day, and within the per-booking limit", () => {
  const ok = windowChecks(user(), resource(), at(11), at(13), [], NOW);
  assert.deepEqual(failing(ok), []);
  assert.ok(failing(windowChecks(user(), resource(), at(16), at(18), [], NOW)).includes("hours"));
  assert.ok(failing(windowChecks(user(), resource(), at(10), at(13), [], NOW)).includes("duration"));
  assert.ok(failing(windowChecks(user(), resource(), at(11, 5), at(12, 5), [], NOW)).includes("hours")); // Saturday
});

test("fair-share cap counts hours held within 7 days", () => {
  const held = [booking({ start: at(10, 1), end: at(12, 1) }), booking({ start: at(10, 2), end: at(11, 2) })];
  assert.equal(weeklyHours(held, "r1", at(10, 3)), 3);
  assert.ok(failing(windowChecks(user(), resource(), at(10, 3), at(12, 3), held, NOW)).includes("fair-share")); // 3 + 2 > 4
  assert.ok(!failing(windowChecks(user(), resource(), at(10, 3), at(11, 3), held, NOW)).includes("fair-share")); // 3 + 1 = 4
});

test("cancelled and rejected bookings do not count against the cap", () => {
  const held = [booking({ status: "cancelled", start: at(10, 1), end: at(14, 1) }), booking({ status: "rejected", start: at(10, 2), end: at(14, 2) })];
  assert.equal(weeklyHours(held, "r1", at(10, 3)), 0);
});

test("open request limit stops one person queueing everything", () => {
  const open = [1, 2, 3].map((d) => booking({ status: "pending", start: at(10, d), end: at(11, d), resourceId: `x${d}` }));
  assert.ok(failing(windowChecks(user(), resource(), at(10, 4), at(11, 4), open, NOW)).includes("open-requests"));
});

test("priority favours coursework and first-time users, penalises heavy use and strikes", () => {
  const fresh = priorityScore({ purposeType: "coursework", createdAt: NOW, resourceId: "r1" }, { strikes: 0 }, [], NOW);
  assert.equal(fresh.score, 80);
  const heavy = [booking({ status: "closed", start: NOW - 5 * DAY, end: NOW - 5 * DAY + 6 * HOUR })];
  const repeat = priorityScore({ purposeType: "personal", createdAt: NOW, resourceId: "r1" }, { strikes: 1 }, heavy, NOW);
  assert.equal(repeat.score, 50 + 0 - 12 - 10);
  assert.ok(fresh.score > repeat.score);
});

test("overlap detection treats back-to-back slots as free", () => {
  assert.ok(overlaps({ start: 1, end: 5 }, { start: 4, end: 8 }));
  assert.ok(!overlaps({ start: 1, end: 5 }, { start: 5, end: 8 }));
});

test("plain-language matching explains itself", () => {
  const [top] = matchResources("cut acrylic panels", [resource(), resource({ id: "r2", name: "Seminar Hall", tags: "hall,talk", description: "hall" })]);
  assert.equal(top.r.id, "r1");
  assert.ok(top.reasons.length > 0);
});
