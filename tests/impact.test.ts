import { test } from "node:test";
import assert from "node:assert/strict";
import { computeImpact, fmtINR, openHours, recommend, unmetKind, wasUsed, type ImpactBooking, type ImpactResource } from "../src/lib/impact-math";
import { parseCampusLocal } from "../src/lib/time";

const at = (s: string) => parseCampusLocal(s)!;
const FROM = at("2026-11-02T00:00"); // Monday
const TO = at("2026-11-09T00:00"); // next Monday: 7 days

const laser: ImpactResource = {
  id: "r1",
  name: "Laser",
  emoji: "🔥",
  department: "Mechanical",
  category: "equipment",
  openHour: 9,
  closeHour: 17,
  openDays: "[1,2,3,4,5]",
  status: "active",
  marketRatePerHour: 100,
  purchaseValue: 182_500, // ₹100 a day over a 5-year life
  createdAt: 0,
};
const b = (id: string, userId: string, start: string, end: string, status: ImpactBooking["status"], extra: Partial<ImpactBooking> = {}): ImpactBooking => ({
  id,
  resourceId: "r1",
  userId,
  start: at(start),
  end: at(end),
  status,
  decisionReason: null,
  returnAt: null,
  ...extra,
});

const bookings: ImpactBooking[] = [
  b("b1", "ece", "2026-11-02T10:00", "2026-11-02T12:00", "closed", { returnAt: at("2026-11-02T11:55") }),
  b("b2", "mech", "2026-11-03T10:00", "2026-11-03T14:00", "closed", { returnAt: at("2026-11-03T14:30") }),
  b("b3", "mech", "2026-11-04T13:00", "2026-11-04T14:00", "closed", { decisionReason: "No-show: the slot ended without a check-in." }),
  b("b4", "ece", "2026-11-03T11:00", "2026-11-03T13:00", "waitlisted"),
  b("b5", "ece", "2026-11-04T09:00", "2026-11-04T11:00", "rejected", { decisionReason: "Fair-share weekly cap reached (4 h on this resource)." }),
  b("b6", "mech", "2026-11-05T09:00", "2026-11-05T10:00", "rejected", { decisionReason: "PVC and vinyl are not allowed on the laser cutter." }),
];
const users = [
  { id: "ece", department: "ECE" },
  { id: "mech", department: "Mechanical" },
];
const incidents = [{ id: "i1", resourceId: "r1", createdAt: at("2026-11-03T15:00") }];

test("classifies used and unmet bookings", () => {
  assert.equal(wasUsed(bookings[0]), true);
  assert.equal(wasUsed(bookings[2]), false, "no-show is not use");
  assert.equal(unmetKind(bookings[3]), "waitlist");
  assert.equal(unmetKind(bookings[4]), "cap");
  assert.equal(unmetKind(bookings[5]), null, "a policy rejection is not unmet capacity");
  assert.equal(unmetKind({ status: "rejected", decisionReason: "Slot already taken by an approved booking" }), "taken");
});

test("open hours follow opening days and hours", () => {
  assert.equal(openHours(laser, FROM, TO), 40);
  assert.equal(openHours({ ...laser, createdAt: at("2026-11-04T00:00") }, FROM, TO), 24, "only since the listing went live");
});

test("impact totals on a known fixture", () => {
  const r = computeImpact({ resources: [laser], bookings, incidents, users, from: FROM, to: TO });
  const t = r.totals;
  assert.equal(r.days, 7);
  assert.equal(t.bookedHours, 6);
  assert.equal(t.openHours, 40);
  assert.equal(t.utilisation, 0.15);
  assert.equal(t.crossDeptHours, 2);
  assert.ok(Math.abs(t.crossDeptShare - 1 / 3) < 1e-9);
  assert.equal(t.saved, 600);
  assert.equal(t.people, 2);
  assert.equal(t.uses, 2);
  assert.equal(t.unmetHours, 4);
  assert.equal(t.onTimeRate, 0.5);
  assert.equal(t.incidentsPer100, 50);
  assert.equal(r.previous, null);

  const res = r.resources[0];
  assert.equal(res.idleHours, 34);
  assert.equal(res.costPerUse, 350, "₹700 of amortised capital over the week / 2 uses");
  assert.equal(res.rentPerUse, 300, "3 h average × ₹100");
  assert.deepEqual(res.unmetByKind, { waitlist: 2, taken: 0, cap: 2 });
  assert.equal(res.recommendation, null, "15% utilisation does not justify a second unit");
});

test("cross-department matrix and demand heatmap", () => {
  const r = computeImpact({ resources: [laser], bookings, incidents, users, from: FROM, to: TO });
  assert.deepEqual(r.matrix.ownerDepts, ["Mechanical"]);
  assert.deepEqual(r.matrix.borrowerDepts, ["Mechanical", "ECE"]);
  assert.deepEqual(r.matrix.hours, [[4], [2]]);
  const cell = (day: number, hour: number) => r.heatmap.demand[r.heatmap.days.indexOf(day)][r.heatmap.hours.indexOf(hour)];
  assert.equal(cell(1, 10), 1);
  assert.equal(cell(2, 11), 2, "used + waitlisted demand overlap on Tuesday 11:00");
  assert.equal(cell(3, 9), 1, "cap-blocked demand counts");
  assert.equal(cell(4, 9), 0, "policy rejection is not demand");
  assert.equal(r.heatmap.max, 2);
});

test("weekly trend buckets and previous period", () => {
  const earlier = [26, 27, 28, 29, 30].map((d) => b(`e${d}`, "mech", `2026-10-${d}T10:00`, `2026-10-${d}T11:00`, "closed", { returnAt: at(`2026-10-${d}T11:00`) }));
  const r = computeImpact({ resources: [laser], bookings: [...earlier, ...bookings], incidents, users, from: FROM, to: TO });
  assert.equal(r.trend.length, 7, "daily buckets for a 7-day range");
  assert.equal(r.trend.reduce((s, d) => s + d.bookedHours, 0), 6);
  assert.equal(r.trend[1].bookedHours, 4, "Tuesday");
  assert.ok(r.previous);
  assert.equal(r.previous!.bookedHours, 5);
  const thin = computeImpact({ resources: [laser], bookings: [earlier[0], ...bookings], incidents, users, from: FROM, to: TO });
  assert.equal(thin.previous, null, "too little earlier history to compare against");
});

test("second-unit recommendation with payback", () => {
  const rec = recommend({ name: "Laser", utilisation: 0.8, purchaseValue: 120_000, marketRatePerHour: 1000 }, 20, 30);
  assert.ok(rec);
  assert.equal(rec!.kind, "second_unit");
  assert.equal(rec!.monthlyValue, 20_000);
  assert.equal(rec!.paybackMonths, 6);
  assert.equal(recommend({ name: "Hall", utilisation: 0.8, purchaseValue: 0, marketRatePerHour: 2000 }, 20, 30)!.kind, "extend_hours");
  assert.equal(recommend({ name: "Kit", utilisation: 0.2, purchaseValue: 1000, marketRatePerHour: 100 }, 20, 30), null);
});

test("Indian digit grouping", () => {
  assert.equal(fmtINR(123456), "₹1,23,456");
});
