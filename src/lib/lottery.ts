// Verifiable weighted lottery for high-demand resources.
//
// PURE MODULE: no database, no "server-only", no Node-only APIs. The exact same code runs on the
// server when a round is drawn and in the browser when anyone presses "Verify in your browser".
// It only uses the standard Web Crypto API (globalThis.crypto.subtle), available in Node 20+ and
// every modern browser.
//
// The algorithm, in plain words:
//  1. When a round opens, the server draws 32 random bytes (the seed) and immediately publishes
//     sha256(seed), the "commitment". The seed itself stays secret until the draw.
//  2. Each entry gets a random number u in (0,1) computed as HMAC-SHA256(seed, bookingId). Nobody
//     can predict u before the seed is revealed, and nobody can change the seed afterwards without
//     the commitment no longer matching.
//  3. Each entry has a weight w derived from its published priority score (which includes fairness
//     credits): w = max(score, 10) / 10.
//  4. Efraimidis–Spirakis weighted shuffle: key = u^(1/w). Sorting by key, highest first, gives a
//     random order in which an entry with weight w is first with probability w / (sum of weights).
//  5. Walk the order and give each entry its slot unless it overlaps a slot already given in this
//     round (or an existing approved booking), or it would push that person past their fair-share cap.

export const HOUR_MS = 3_600_000;

/** Points added to the priority score per fairness credit. */
export const CREDIT_POINTS = 10;
/** Credits stop accumulating at this many (so a long losing streak cannot become a guarantee). */
export const MAX_CREDITS = 3;
/** Scores below this still get a fair chance: nobody's weight drops to zero. */
export const WEIGHT_FLOOR_SCORE = 10;

export const WEIGHT_FORMULA = "w = max(priority score, 10) ÷ 10";
export const KEY_FORMULA = "key = u ^ (1 / w)";
export const U_FORMULA = "u = first 53 bits of HMAC-SHA256(key = seed, message = booking id) as a fraction in (0, 1)";

export function weightFromScore(score: number) {
  return Math.max(score, WEIGHT_FLOOR_SCORE) / 10;
}

export type Outcome = "won" | "overlap" | "cap" | "blocked";

export type DrawInputEntry = {
  bookingId: string;
  person: number; // pseudonymous entrant number within this round (1, 2, 3 …)
  start: number;
  end: number;
  score: number; // published priority score at entry time (includes fairness credits)
};

export type DrawPerson = { person: number; capHours: number }; // hours this person may still take this week

export type DrawEntryResult = DrawInputEntry & {
  weight: number;
  u: number;
  key: number;
  rank: number; // 1 = drawn first
  outcome: Outcome;
  beatenBy: number | null; // rank of the entry (or 0 = existing booking) that took the overlapping slot
};

export type DrawLog = {
  version: 1;
  algorithm: string;
  weightFormula: string;
  resourceId: string;
  dayStart: number;
  closesAt: number;
  drawnAt: number;
  early: boolean; // drawn before closing time by the owner in demo mode
  commitment: string;
  blocked: { start: number; end: number }[]; // approved bookings outside the round
  people: DrawPerson[];
  entries: DrawEntryResult[];
  overrides: { bookingId: string; reason: string; at: number; promoted: string[] }[];
};

// ---------------------------------------------------------------- crypto helpers

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("Web Crypto is not available (a secure context is needed).");
  return c.subtle;
}

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (!/^[0-9a-f]*$/i.test(hex) || hex.length % 2) throw new Error("Not a hex string.");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: ArrayBuffer | Uint8Array) {
  return Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A fresh 32-byte seed as hex. */
export function newSeed() {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return bytesToHex(b);
}

/** Commitment published while a round is open: sha256 of the 32 seed bytes, hex. */
export async function commitmentOf(seedHex: string) {
  return bytesToHex(await subtle().digest("SHA-256", hexToBytes(seedHex)));
}

/** u in (0,1): first 53 bits of HMAC-SHA256(seed, bookingId). */
export async function uniformFor(seedHex: string, bookingId: string) {
  const key = await subtle().importKey("raw", hexToBytes(seedHex), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await subtle().sign("HMAC", key, new TextEncoder().encode(bookingId)));
  let n = 0;
  for (let i = 0; i < 6; i++) n = n * 256 + mac[i]; // 48 bits, exact in a double
  n = n * 32 + (mac[6] >> 3); // + 5 bits = 53 bits
  return (n + 0.5) / 2 ** 53;
}

// ---------------------------------------------------------------- the draw

const overlap = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

/** Order entries by their keys (highest first; ties, which are practically impossible, by booking id). */
export function rankByKey<T extends { key: number; bookingId: string }>(entries: T[]) {
  return [...entries].sort((a, b) => b.key - a.key || (a.bookingId < b.bookingId ? -1 : 1));
}

/**
 * Greedy allocation in draw order. Entries in `excluded` (overridden by the owner) are skipped.
 * Returns outcome + who beat each losing entry. Pure and deterministic.
 */
export function allocate(
  ranked: (DrawInputEntry & { rank: number })[],
  blocked: { start: number; end: number }[],
  people: DrawPerson[],
  excluded: Set<string> = new Set(),
) {
  const won: (DrawInputEntry & { rank: number })[] = [];
  const used = new Map<number, number>();
  const result = new Map<string, { outcome: Outcome; beatenBy: number | null }>();
  for (const e of ranked) {
    if (excluded.has(e.bookingId)) continue;
    const hours = (e.end - e.start) / HOUR_MS;
    const cap = people.find((p) => p.person === e.person)?.capHours ?? 0;
    const taken = won.find((w) => overlap(w, e));
    if (blocked.some((b) => overlap(b, e))) result.set(e.bookingId, { outcome: "blocked", beatenBy: 0 });
    else if (taken) result.set(e.bookingId, { outcome: "overlap", beatenBy: taken.rank });
    else if ((used.get(e.person) ?? 0) + hours > cap + 1e-9) result.set(e.bookingId, { outcome: "cap", beatenBy: null });
    else {
      won.push(e);
      used.set(e.person, (used.get(e.person) ?? 0) + hours);
      result.set(e.bookingId, { outcome: "won", beatenBy: null });
    }
  }
  return result;
}

/** Run the full draw. Same (seed, entries, blocked, people) ⇒ same result, on any machine. */
export async function runDraw(
  seedHex: string,
  entries: DrawInputEntry[],
  blocked: { start: number; end: number }[],
  people: DrawPerson[],
): Promise<DrawEntryResult[]> {
  const keyed = await Promise.all(
    entries.map(async (e) => {
      const weight = weightFromScore(e.score);
      const u = await uniformFor(seedHex, e.bookingId);
      return { ...e, weight, u, key: Math.pow(u, 1 / weight) };
    }),
  );
  const ranked = rankByKey(keyed).map((e, i) => ({ ...e, rank: i + 1 }));
  const outcomes = allocate(ranked, blocked, people);
  return ranked.map((e) => ({ ...e, ...outcomes.get(e.bookingId)! }));
}

export type VerifyReport = {
  commitmentOk: boolean;
  computedCommitment: string;
  resultsOk: boolean;
  mismatches: string[];
  recomputed: DrawEntryResult[];
};

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));

/** Independently recompute a published draw and compare with what the server recorded. */
export async function verifyDraw(log: Pick<DrawLog, "commitment" | "entries" | "blocked" | "people">, seedHex: string): Promise<VerifyReport> {
  const computedCommitment = await commitmentOf(seedHex);
  const recomputed = await runDraw(
    seedHex,
    log.entries.map(({ bookingId, person, start, end, score }) => ({ bookingId, person, start, end, score })),
    log.blocked,
    log.people,
  );
  const mismatches: string[] = [];
  for (const r of recomputed) {
    const s = log.entries.find((e) => e.bookingId === r.bookingId)!;
    if (!close(s.weight, r.weight)) mismatches.push(`Entry ranked ${s.rank}: weight ${s.weight} ≠ ${r.weight}`);
    if (!close(s.u, r.u)) mismatches.push(`Entry ranked ${s.rank}: u differs`);
    if (!close(s.key, r.key)) mismatches.push(`Entry ranked ${s.rank}: key differs`);
    if (s.rank !== r.rank) mismatches.push(`Entry recorded at rank ${s.rank} recomputes to rank ${r.rank}`);
    if (s.outcome !== r.outcome) mismatches.push(`Entry ranked ${s.rank}: recorded "${s.outcome}", recomputed "${r.outcome}"`);
  }
  return { commitmentOk: computedCommitment === log.commitment, computedCommitment, resultsOk: mismatches.length === 0, mismatches, recomputed };
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  won: "Won",
  overlap: "Slot taken by an earlier draw",
  cap: "Would exceed fair-share cap",
  blocked: "Clashes with an existing booking",
};
