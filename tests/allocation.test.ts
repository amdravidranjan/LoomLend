import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import {
  CREDIT_POINTS,
  MAX_CREDITS,
  allocate,
  commitmentOf,
  newSeed,
  runDraw,
  uniformFor,
  verifyDraw,
  weightFromScore,
  type DrawInputEntry,
  type DrawPerson,
} from "../src/lib/lottery";
import { gini, lorenz, median, topShare } from "../src/lib/inequality";
import { priorityScore, roundTiming } from "../src/lib/rules";
import { parseCampusLocal } from "../src/lib/time";

const H = 3_600_000;
const SEED = "a3".repeat(32);
const day = parseCampusLocal("2026-11-04T00:00")!;
const entry = (bookingId: string, person: number, from: number, to: number, score = 50): DrawInputEntry => ({
  bookingId,
  person,
  start: day + from * H,
  end: day + to * H,
  score,
});
const roomy = (n: number, hours = 100): DrawPerson[] => Array.from({ length: n }, (_, i) => ({ person: i + 1, capHours: hours }));
const seedFor = (i: number) => createHash("sha256").update(`seed-${i}`).digest("hex");

test("commitment is sha256 of the 32 seed bytes and matches Node's implementation", async () => {
  const s = newSeed();
  assert.match(s, /^[0-9a-f]{64}$/);
  assert.equal(await commitmentOf(s), createHash("sha256").update(Buffer.from(s, "hex")).digest("hex"));
  assert.notEqual(await commitmentOf(s), await commitmentOf(newSeed()));
});

test("u is derived from HMAC-SHA256(seed, bookingId) and lies in (0,1)", async () => {
  const u = await uniformFor(SEED, "booking-1");
  const mac = createHmac("sha256", Buffer.from(SEED, "hex")).update("booking-1").digest();
  let n = 0;
  for (let i = 0; i < 6; i++) n = n * 256 + mac[i];
  n = n * 32 + (mac[6] >> 3);
  assert.equal(u, (n + 0.5) / 2 ** 53);
  assert.ok(u > 0 && u < 1);
});

test("the draw is deterministic: same seed and entries give the same result, whatever the input order", async () => {
  const entries = [entry("a", 1, 10, 12, 80), entry("b", 2, 11, 13, 40), entry("c", 3, 14, 16, 60), entry("d", 4, 10, 11, 50)];
  const one = await runDraw(SEED, entries, [], roomy(4));
  const two = await runDraw(SEED, [...entries].reverse(), [], roomy(4));
  assert.deepEqual(one, two);
  const other = await runDraw(seedFor(1), entries, [], roomy(4));
  assert.notDeepEqual(
    one.map((e) => e.key),
    other.map((e) => e.key),
  ); // a different seed gives different random numbers
});

test("weights follow the published formula and include fairness credits via the priority score", () => {
  assert.equal(weightFromScore(80), 8);
  assert.equal(weightFromScore(-20), 1); // floor: nobody's chance is zero
  const base = priorityScore({ purposeType: "personal", createdAt: day, resourceId: "r1" }, { strikes: 0 }, [], day);
  const boosted = priorityScore({ purposeType: "personal", createdAt: day, resourceId: "r1" }, { strikes: 0 }, [], day, 2);
  assert.equal(boosted.score - base.score, 2 * CREDIT_POINTS);
  assert.ok(boosted.factors.some((f) => f.label.startsWith("Fairness credits: 2")));
  const capped = priorityScore({ purposeType: "personal", createdAt: day, resourceId: "r1" }, { strikes: 0 }, [], day, 99);
  assert.equal(capped.score - base.score, MAX_CREDITS * CREDIT_POINTS);
});

test("weight monotonicity: a heavier entry is drawn first about w1/(w1+w2) of the time and never ranks worse on average", async () => {
  const N = 1500;
  let heavyFirst = 0;
  const rankSum = { heavy: 0, mid: 0, light: 0 };
  for (let i = 0; i < N; i++) {
    const res = await runDraw(seedFor(i), [entry("heavy", 1, 10, 12, 90), entry("mid", 2, 10, 12, 50), entry("light", 3, 10, 12, 20)], [], roomy(3));
    for (const e of res) rankSum[e.bookingId as keyof typeof rankSum] += e.rank;
    if (res[0].bookingId === "heavy") heavyFirst++;
  }
  // P(first) = 9 / (9 + 5 + 2) = 0.5625 for Efraimidis–Spirakis.
  const p = heavyFirst / N;
  assert.ok(Math.abs(p - 9 / 16) < 0.05, `heavy drawn first ${p}`);
  assert.ok(rankSum.heavy < rankSum.mid && rankSum.mid < rankSum.light, JSON.stringify(rankSum));
});

test("raising one entry's weight never lowers its chance of winning (same seeds)", async () => {
  let wonLow = 0;
  let wonHigh = 0;
  for (let i = 0; i < 400; i++) {
    const rivals = [entry("r1", 2, 10, 12, 60), entry("r2", 3, 11, 13, 60)];
    const low = await runDraw(seedFor(i), [entry("me", 1, 10, 12, 40), ...rivals], [], roomy(3));
    const high = await runDraw(seedFor(i), [entry("me", 1, 10, 12, 70), ...rivals], [], roomy(3));
    const lowWon = low.find((e) => e.bookingId === "me")!.outcome === "won";
    const highWon = high.find((e) => e.bookingId === "me")!.outcome === "won";
    if (lowWon) assert.ok(highWon, `seed ${i}: won at weight 4 but lost at weight 7`); // pointwise: same u, bigger key
    wonLow += Number(lowWon);
    wonHigh += Number(highWon);
  }
  assert.ok(wonHigh > wonLow);
});

test("allocation never gives overlapping slots and respects the fair-share cap", async () => {
  for (let i = 0; i < 200; i++) {
    const entries = [
      entry("a", 1, 10, 12),
      entry("b", 2, 11, 13),
      entry("c", 1, 13, 15),
      entry("d", 3, 12, 14),
      entry("e", 2, 14, 16),
      entry("f", 1, 15, 17),
    ];
    const people: DrawPerson[] = [
      { person: 1, capHours: 4 },
      { person: 2, capHours: 2 },
      { person: 3, capHours: 0 },
    ];
    const res = await runDraw(seedFor(i), entries, [{ start: day + 16.5 * H, end: day + 18 * H }], people);
    const won = res.filter((e) => e.outcome === "won");
    for (const x of won) for (const y of won) if (x !== y) assert.ok(!(x.start < y.end && y.start < x.end), "overlap");
    for (const p of people) {
      const hours = won.filter((e) => e.person === p.person).reduce((s, e) => s + (e.end - e.start) / H, 0);
      assert.ok(hours <= p.capHours, `person ${p.person} got ${hours} h > cap ${p.capHours}`);
    }
    assert.notEqual(res.find((e) => e.bookingId === "d")!.outcome, "won"); // person 3 has no room left
    assert.equal(res.find((e) => e.bookingId === "f")!.outcome === "won", false); // 15–17 clashes with the 16:30 booking
    const d = res.find((e) => e.bookingId === "d")!;
    if (!res.some((e) => e.outcome === "won" && e.rank < d.rank && e.start < d.end && d.start < e.end)) assert.equal(d.outcome, "cap");
    for (const l of res.filter((e) => e.outcome === "overlap")) {
      const by = res.find((e) => e.rank === l.beatenBy)!;
      assert.equal(by.outcome, "won");
      assert.ok(by.rank < l.rank);
    }
  }
});

test("override re-allocation with the same keys moves the next entry up", async () => {
  const res = await runDraw(SEED, [entry("a", 1, 10, 12, 90), entry("b", 2, 10, 12, 50), entry("c", 3, 10, 12, 50)], [], roomy(3));
  const winner = res.find((e) => e.outcome === "won")!;
  const after = allocate(res, [], roomy(3), new Set([winner.bookingId]));
  const next = res.filter((e) => e.bookingId !== winner.bookingId).sort((x, y) => x.rank - y.rank)[0];
  assert.equal(after.get(next.bookingId)!.outcome, "won");
  assert.equal(after.has(winner.bookingId), false);
});

test("verification passes for an honest log and catches a wrong seed or tampered result", async () => {
  const seed = newSeed();
  const entries = [entry("a", 1, 10, 12, 80), entry("b", 2, 11, 13, 40), entry("c", 3, 10, 11, 60)];
  const results = await runDraw(seed, entries, [], roomy(3));
  const log = { commitment: await commitmentOf(seed), entries: results, blocked: [], people: roomy(3) };
  const ok = await verifyDraw(log, seed);
  assert.ok(ok.commitmentOk && ok.resultsOk, ok.mismatches.join("; "));

  const wrongSeed = await verifyDraw(log, newSeed());
  assert.equal(wrongSeed.commitmentOk, false);

  const tampered = { ...log, entries: results.map((e) => (e.outcome === "won" ? { ...e, outcome: "overlap" as const } : e)) };
  assert.equal((await verifyDraw(tampered, seed)).resultsOk, false);
  const reweighted = { ...log, entries: results.map((e, i) => (i === 0 ? { ...e, score: e.score + 30 } : e)) };
  assert.equal((await verifyDraw(reweighted, seed)).resultsOk, false);
});

test("round timing: requests close lead-hours before campus midnight of the slot's day", () => {
  const slot = parseCampusLocal("2026-11-05T13:00")!;
  const t = roundTiming({ roundLeadHours: 24 }, slot);
  assert.equal(t.dayStart, parseCampusLocal("2026-11-05T00:00"));
  assert.equal(t.closesAt, parseCampusLocal("2026-11-04T00:00"));
});

test("Gini, Lorenz and top-10% share on known inputs", () => {
  assert.equal(gini([5, 5, 5, 5]), 0);
  assert.equal(gini([]), 0);
  assert.equal(gini([0, 0, 0]), 0);
  assert.ok(Math.abs(gini([0, 0, 0, 10]) - 0.75) < 1e-12); // (n-1)/n when one person has everything
  assert.ok(Math.abs(gini([1, 2, 3, 4]) - 0.25) < 1e-12);
  assert.deepEqual(lorenz([1, 3]), [
    { p: 0, share: 0 },
    { p: 0.5, share: 0.25 },
    { p: 1, share: 1 },
  ]);
  const l = lorenz([4, 1, 2, 3]);
  assert.equal(l.at(-1)!.share, 1);
  for (let i = 1; i < l.length; i++) assert.ok(l[i].share >= l[i - 1].share);
  assert.equal(topShare([10, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 1);
  assert.ok(Math.abs(topShare(Array.from({ length: 20 }, () => 1)) - 0.1) < 1e-12);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});
