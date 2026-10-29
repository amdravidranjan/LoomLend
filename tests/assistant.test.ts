import { test } from "node:test";
import assert from "node:assert/strict";
import type { Booking, Resource } from "../src/db/schema";
import { mergeIntent, parseIntent } from "../src/lib/assistant-parse";
import { findSlots } from "../src/lib/assistant-slots";
import { parseCampusLocal } from "../src/lib/time";

const HOUR = 3_600_000;
// Wednesday 28 Oct 2026, 15:00 IST.
const NOW = parseCampusLocal("2026-10-28T15:00")!;
const at = (local: string) => parseCampusLocal(local)!;

// ---------------------------------------------------------------- parser

test("parses weekday + part of day + keywords", () => {
  const i = parseIntent("I need to film an interview Friday afternoon", NOW);
  assert.equal(i.kind, "find");
  assert.equal(i.fromDate, "2026-10-30");
  assert.equal(i.toDate, "2026-10-30");
  assert.equal(i.partOfDay, "afternoon");
  assert.match(i.query, /film/);
  assert.match(i.query, /interview/);
  assert.doesNotMatch(i.query, /friday|afternoon|need/);
  assert.equal(i.purposeType, "project");
});

test("today, tomorrow, next Monday, day after tomorrow", () => {
  assert.equal(parseIntent("oscilloscope today", NOW).fromDate, "2026-10-28");
  assert.equal(parseIntent("oscilloscope tomorrow", NOW).fromDate, "2026-10-29");
  assert.equal(parseIntent("scope day after tomorrow", NOW).fromDate, "2026-10-30");
  assert.equal(parseIntent("hall next Monday", NOW).fromDate, "2026-11-02");
  // A bare weekday that is today means today; "next" skips to next week.
  assert.equal(parseIntent("printer wednesday", NOW).fromDate, "2026-10-28");
  assert.equal(parseIntent("printer next wednesday", NOW).fromDate, "2026-11-04");
});

test("explicit dates: 28 Oct, Nov 3rd, 3/11, and year roll-over", () => {
  assert.equal(parseIntent("laser on 28 Oct", NOW).fromDate, "2026-10-28");
  assert.equal(parseIntent("laser Nov 3rd", NOW).fromDate, "2026-11-03");
  assert.equal(parseIntent("laser on 3/11", NOW).fromDate, "2026-11-03");
  assert.equal(parseIntent("laser on 5 January", NOW).fromDate, "2027-01-05");
});

test("explicit times and ranges", () => {
  const a = parseIntent("meeting room tomorrow at 3pm for an hour", NOW);
  assert.equal(a.startMinutes, 15 * 60);
  assert.equal(a.exactStart, true);
  assert.equal(a.durationHours, 1);
  const b = parseIntent("studio 2-4pm on friday", NOW);
  assert.equal(b.startMinutes, 14 * 60);
  assert.equal(b.endMinutes, 16 * 60);
  assert.equal(b.durationHours, 2);
  const c = parseIntent("gpu from 10:30 to 1 pm", NOW);
  assert.equal(c.startMinutes, 10 * 60 + 30);
  assert.equal(c.endMinutes, 13 * 60);
  const d = parseIntent("hall after 4 tomorrow", NOW);
  assert.equal(d.startMinutes, 16 * 60);
  assert.equal(d.exactStart, false);
});

test("durations: hours, words, half, minutes", () => {
  assert.equal(parseIntent("gpu for 4 hours", NOW).durationHours, 4);
  assert.equal(parseIntent("gpu for two hours", NOW).durationHours, 2);
  assert.equal(parseIntent("scope for half an hour", NOW).durationHours, 0.5);
  assert.equal(parseIntent("scope for 90 minutes", NOW).durationHours, 1.5);
  assert.equal(parseIntent("printer 3h", NOW).durationHours, 3);
});

test("does not mistake '3d printer' or course codes for times", () => {
  const i = parseIntent("3d printer for EC6702 tomorrow", NOW);
  assert.equal(i.startMinutes, undefined);
  assert.equal(i.purposeType, "coursework");
  assert.match(i.query, /3d/);
  assert.match(i.query, /printer/);
});

test("recognises bookings and policy questions", () => {
  assert.equal(parseIntent("What have I booked?", NOW).kind, "my_bookings");
  assert.equal(parseIntent("show my bookings", NOW).kind, "my_bookings");
  const p = parseIntent("How does the waiting list work?", NOW);
  assert.equal(p.kind, "policy");
  assert.equal(p.policyTopic, "waitlist");
});

test("follow-ups keep the earlier need and override what they change", () => {
  const first = parseIntent("I need to film an interview Friday afternoon", NOW);
  const merged = mergeIntent(first, parseIntent("make it 3 hours", NOW), false);
  assert.equal(merged.durationHours, 3);
  assert.equal(merged.fromDate, "2026-10-30");
  assert.equal(merged.partOfDay, "afternoon");
  assert.equal(merged.query, first.query);
  const moved = mergeIntent(merged, parseIntent("what about Saturday morning?", NOW), false);
  assert.equal(moved.fromDate, "2026-10-31");
  assert.equal(moved.partOfDay, "morning");
  assert.equal(moved.durationHours, 3);
});

// ---------------------------------------------------------------- slot finder

const resource = (o: Partial<Resource> = {}) =>
  ({ id: "r1", openHour: 9, closeHour: 18, openDays: "[1,2,3,4,5]", maxHours: 4, weeklyHourCap: 8, ...o }) as Resource;
const booking = (o: Partial<Booking>) =>
  ({ id: crypto.randomUUID(), resourceId: "r1", userId: "me", status: "approved", start: 0, end: 0, ...o }) as Booking;

test("finds slots inside opening hours and the requested part of day", () => {
  const out = findSlots(resource(), { fromDate: "2026-10-30", toDate: "2026-10-30", durationHours: 2, partOfDay: "afternoon" }, { now: NOW, holders: [], pending: [], userBookings: [] });
  assert.ok(out.slots.length > 0);
  for (const s of out.slots) {
    assert.ok(s.start >= at("2026-10-30T12:00"));
    assert.ok(s.end <= at("2026-10-30T18:00"));
    assert.equal(s.end - s.start, 2 * HOUR);
  }
  // At most two per day and never overlapping.
  assert.ok(out.slots.length <= 2);
  if (out.slots.length === 2) assert.ok(out.slots[1].start >= out.slots[0].end);
});

test("skips closed days and the past, and clamps to the session limit", () => {
  const sat = findSlots(resource(), { fromDate: "2026-10-31", toDate: "2026-11-01", durationHours: 2 }, { now: NOW, holders: [], pending: [], userBookings: [] });
  assert.equal(sat.slots.length, 0);
  assert.deepEqual(sat.closedDays, ["2026-10-31", "2026-11-01"]);
  const today = findSlots(resource(), { fromDate: "2026-10-28", toDate: "2026-10-28", durationHours: 6 }, { now: NOW, holders: [], pending: [], userBookings: [] });
  assert.equal(today.durationHours, 4);
  assert.equal(today.durationClamped, true);
  assert.equal(today.slots.length, 0, "15:00 + 4 h runs past 18:00 closing");
});

test("avoids approved holders, offers the waiting list, flags contested slots", () => {
  const holder = { start: at("2026-10-30T09:00"), end: at("2026-10-30T18:00") };
  const full = findSlots(resource(), { fromDate: "2026-10-30", toDate: "2026-10-30", durationHours: 2 }, { now: NOW, holders: [holder], pending: [], userBookings: [] });
  assert.equal(full.slots.length, 0);
  assert.ok(full.takenSlots.length > 0);
  assert.deepEqual(full.heldWindows, [holder]);

  const pending = { start: at("2026-10-30T09:00"), end: at("2026-10-30T11:00") };
  const some = findSlots(resource(), { fromDate: "2026-10-30", toDate: "2026-10-30", durationHours: 1, partOfDay: "morning" }, { now: NOW, holders: [], pending: [pending], userBookings: [], perDay: 1 });
  assert.equal(some.slots.length, 1);
  assert.equal(some.slots[0].contested, false, "uncontested slots are preferred");
  assert.equal(some.slots[0].start, at("2026-10-30T11:00"));
  const all = findSlots(resource(), { fromDate: "2026-10-30", toDate: "2026-10-30", durationHours: 1, partOfDay: "morning" }, { now: NOW, holders: [], pending: [pending], userBookings: [] });
  assert.ok(all.slots.some((s) => s.contested), "pending overlaps are flagged, not hidden");
});

test("exact start time is honoured", () => {
  const out = findSlots(resource(), { fromDate: "2026-10-29", toDate: "2026-10-29", durationHours: 1, earliestStart: 15 * 60, exactStart: true }, { now: NOW, holders: [], pending: [], userBookings: [] });
  assert.equal(out.slots.length, 1);
  assert.equal(out.slots[0].start, at("2026-10-29T15:00"));
});

test("respects the fair-share weekly cap", () => {
  const mine = [booking({ start: at("2026-10-29T09:00"), end: at("2026-10-29T13:00") }), booking({ start: at("2026-10-29T14:00"), end: at("2026-10-29T17:00") })];
  // 7 h held, cap 8 h: a 2 h slot would breach it.
  const out = findSlots(resource(), { fromDate: "2026-10-30", toDate: "2026-10-30", durationHours: 2 }, { now: NOW, holders: [], pending: [], userBookings: mine });
  assert.equal(out.slots.length, 0);
  assert.ok(out.capBlocked > 0);
  assert.equal(out.capRemainingHours, 1);
  const short = findSlots(resource(), { fromDate: "2026-10-30", toDate: "2026-10-30", durationHours: 1 }, { now: NOW, holders: [], pending: [], userBookings: mine });
  assert.ok(short.slots.length > 0);
});

test("stops at the 14-day booking horizon", () => {
  const out = findSlots(resource({ openDays: "[0,1,2,3,4,5,6]" }), { fromDate: "2026-11-10", toDate: "2026-11-20", durationHours: 1 }, { now: NOW, holders: [], pending: [], userBookings: [], limit: 50, perDay: 50 });
  assert.equal(out.beyondHorizon, true);
  for (const s of out.slots) assert.ok(s.start < NOW + 14 * 24 * HOUR);
});
