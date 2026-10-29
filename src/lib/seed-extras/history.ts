import "server-only";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Booking, Resource } from "@/db/schema";
import { audit } from "../audit";
import { overlaps, parseList } from "../rules";
import { DAY, HOUR, campusDayAt, campusParts } from "../time";

// Synthetic history for the impact dashboard (owned by the insights agent).
// ~60 days of closed bookings by ~25 extra, entirely fictional people, with realistic patterns:
// weekday afternoons are busiest; the laser cutter, GPU and camera are in high demand; the tool kit and
// fume hood are underused. Some requests were turned away (waiting list, slot taken, fair-share cap):
// that is the unmet demand the dashboard reports. The main demo personas get no history, so their caps,
// priorities and seeded scenarios are unchanged. Deterministic (fixed PRNG seed).

/** Realistic ₹ figures: what renting the equivalent outside campus costs per hour, and the purchase price. */
const RATES: Record<string, { market: number; purchase: number }> = {
  "r-laser": { market: 1200, purchase: 1_850_000 },
  "r-printer": { market: 250, purchase: 115_000 },
  "r-toolkit": { market: 150, purchase: 42_000 },
  "r-scope": { market: 400, purchase: 95_000 },
  "r-solder": { market: 120, purchase: 28_000 },
  "r-gpu": { market: 180, purchase: 360_000 },
  "r-camera": { market: 450, purchase: 265_000 },
  "r-studio": { market: 1500, purchase: 650_000 },
  "r-hall": { market: 2000, purchase: 0 },
  "r-meeting": { market: 500, purchase: 0 },
  "r-hood": { market: 800, purchase: 480_000 },
  "r-drone": { market: 500, purchase: 98_000 },
};

type Person = { slug: string; name: string; dept: string; aff: "student" | "researcher" | "external"; certs: string[] };
const PEOPLE: Person[] = [
  { slug: "karthik.s", name: "Karthik Subramanian", dept: "ECE", aff: "student", certs: ["lab-safety", "electronics"] },
  { slug: "lakshmi.i", name: "Lakshmi Iyer", dept: "ECE", aff: "student", certs: ["lab-safety", "electronics", "3d-printer"] },
  { slug: "rohan.p", name: "Rohan Pillai", dept: "ECE", aff: "researcher", certs: ["lab-safety", "electronics"] },
  { slug: "ananya.k", name: "Ananya Krishnan", dept: "ECE", aff: "student", certs: ["electronics", "av-studio"] },
  { slug: "aditya.v", name: "Aditya Venkatesh", dept: "CSE", aff: "student", certs: [] },
  { slug: "meera.r", name: "Meera Raghavan", dept: "CSE", aff: "researcher", certs: [] },
  { slug: "siddharth.r", name: "Siddharth Rao", dept: "CSE", aff: "student", certs: ["lab-safety", "3d-printer"] },
  { slug: "nandini.b", name: "Nandini Bhat", dept: "CSE", aff: "student", certs: ["av-studio"] },
  { slug: "vignesh.m", name: "Vignesh Murugan", dept: "Mechanical", aff: "student", certs: ["lab-safety", "laser-cutter", "3d-printer"] },
  { slug: "harini.s", name: "Harini Sekar", dept: "Mechanical", aff: "student", certs: ["lab-safety", "laser-cutter"] },
  { slug: "gokul.r", name: "Gokul Ramesh", dept: "Mechanical", aff: "student", certs: ["lab-safety", "3d-printer"] },
  { slug: "deepak.c", name: "Deepak Chandran", dept: "Mechanical", aff: "researcher", certs: ["lab-safety", "laser-cutter", "drone"] },
  { slug: "ishita.b", name: "Ishita Banerjee", dept: "Media Studies", aff: "student", certs: ["av-studio"] },
  { slug: "tanvi.d", name: "Tanvi Deshpande", dept: "Media Studies", aff: "student", certs: ["av-studio"] },
  { slug: "aravind.n", name: "Aravind Nair", dept: "Media Studies", aff: "student", certs: ["av-studio", "drone"] },
  { slug: "pavithra.g", name: "Pavithra Ganesan", dept: "Chemistry", aff: "researcher", certs: ["lab-safety", "chem-safety"] },
  { slug: "kiran.j", name: "Kiran Joseph", dept: "Chemistry", aff: "researcher", certs: ["lab-safety", "chem-safety"] },
  { slug: "swathi.n", name: "Swathi Narayanan", dept: "Chemistry", aff: "student", certs: ["lab-safety", "chem-safety", "3d-printer"] },
  { slug: "manoj.k", name: "Manoj Kumaravel", dept: "Civil", aff: "student", certs: ["lab-safety", "laser-cutter"] },
  { slug: "revathi.s", name: "Revathi Sundaram", dept: "Civil", aff: "student", certs: ["lab-safety"] },
  { slug: "fathima.r", name: "Fathima Rizwana", dept: "Biotech", aff: "researcher", certs: ["lab-safety", "chem-safety"] },
  { slug: "joel.t", name: "Joel Thomas", dept: "Biotech", aff: "student", certs: ["lab-safety", "3d-printer"] },
  { slug: "nikhil.v", name: "Nikhil Varma", dept: "Architecture", aff: "student", certs: ["lab-safety", "laser-cutter", "3d-printer"] },
  { slug: "shruti.a", name: "Shruti Agarwal", dept: "Architecture", aff: "student", certs: ["lab-safety", "laser-cutter"] },
  { slug: "yash.m", name: "Yash Malhotra", dept: "Management", aff: "student", certs: ["av-studio"] },
  { slug: "zara.s", name: "Zara Sheikh", dept: "Incubation Cell", aff: "external", certs: [] },
];

/** Expected requests per open day. High demand: laser, GPU, camera. Underused: tool kit, fume hood. */
const DEMAND: Record<string, number> = {
  "r-laser": 2.7,
  "r-gpu": 2.3,
  "r-camera": 1.5,
  "r-printer": 1.4,
  "r-studio": 0.65,
  "r-scope": 0.5,
  "r-meeting": 0.5,
  "r-hall": 0.35,
  "r-solder": 0.35,
  "r-hood": 0.2,
  "r-toolkit": 0.08,
};
// Busier on weekday afternoons.
const HOUR_WEIGHT: Record<number, number> = { 8: 0.5, 9: 1, 10: 2, 11: 2, 12: 1.2, 13: 2, 14: 3.5, 15: 3.5, 16: 2.5, 17: 1.5, 18: 1.1, 19: 0.9, 20: 0.6, 21: 0.3 };

const PURPOSES: Record<string, [Booking["purposeType"], string][]> = {
  "r-laser": [["coursework", "Cutting MDF gear prototypes for the Design of Machine Elements lab."], ["project", "Laser-cutting acrylic panels for the robotics club's arena."], ["project", "Architectural massing model in 3 mm MDF for studio review."], ["research", "Engraving test coupons for a surface-texture study."]],
  "r-gpu": [["research", "Fine-tuning a vision model on our crop-disease dataset."], ["coursework", "Training the CNN for the Deep Learning course assignment."], ["project", "Rendering the final-year animation project in Blender."], ["research", "Running ablations for a conference paper submission."]],
  "r-camera": [["project", "Shooting a short documentary for the Media Club."], ["coursework", "Photography assignment: campus architecture series."], ["project", "Recording interviews for the alumni oral-history project."]],
  "r-printer": [["coursework", "Printing a bracket for the Machine Design assignment."], ["project", "Printing enclosures for the IoT weather-station project."], ["personal", "Printing a replacement knob I modelled in CAD."]],
  "r-studio": [["project", "Recording an episode of the campus podcast."], ["coursework", "Mass-comm practical: two-camera interview shoot."]],
  "r-scope": [["coursework", "Measuring rise times for the Analog Circuits lab."], ["research", "Debugging the sensor front-end for my thesis rig."]],
  "r-meeting": [["project", "Startup team stand-up and investor call."], ["project", "Capstone team design review."]],
  "r-hall": [["project", "Coding club workshop for first-years."], ["project", "Guest talk organised by the entrepreneurship cell."]],
  "r-solder": [["coursework", "Assembling the PCB for the embedded systems lab."], ["project", "Soldering the drone flight-controller board."]],
  "r-hood": [["research", "Solvent extraction for my natural-products project."], ["research", "Preparing buffer stock under extraction."]],
  "r-toolkit": [["project", "Building the stage set for the cultural fest."], ["personal", "Making a bookshelf in the Fab Lab."]],
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seedHistory(now: number) {
  const rng = mulberry32(20261028);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rng() * xs.length)];
  const weighted = <T,>(xs: [T, number][]) => {
    const total = xs.reduce((s, [, w]) => s + w, 0);
    let r = rng() * total;
    for (const [x, w] of xs) if ((r -= w) <= 0) return x;
    return xs[xs.length - 1][0];
  };

  // 1. Impact figures on every seeded resource. The catalogue has been shared since last semester,
  //    so listings predate the 60 days of history.
  for (const [id, r] of Object.entries(RATES)) {
    await db
      .update(schema.resources)
      .set({ marketRatePerHour: r.market, purchaseValue: r.purchase, createdAt: now - 120 * DAY })
      .where(eq(schema.resources.id, id));
  }

  // 2. People and their verified training.
  const hash = await bcrypt.hash("demo1234", 10);
  for (const p of PEOPLE) {
    const id = `u-h-${p.slug.replace(".", "-")}`;
    await db.insert(schema.users).values({
      id,
      name: p.name,
      email: `${p.slug}@northfield.demo`,
      passwordHash: hash,
      role: "member",
      department: p.dept,
      affiliation: p.aff,
      idVerified: true,
      createdAt: now - (70 + Math.floor(rng() * 200)) * DAY,
    });
    for (const c of p.certs) {
      await db.insert(schema.certifications).values({
        id: `c-${id}-${c}`,
        userId: id,
        certKey: c,
        evidence: "Training register, previous semester.",
        status: "verified",
        reviewedBy: "u-arun",
        reviewedAt: now - 75 * DAY,
        createdAt: now - 80 * DAY,
      });
    }
  }

  // 3. Bookings.
  const resources = await db.select().from(schema.resources);
  const existing = await db.select().from(schema.bookings);
  const occupied = new Map<string, { start: number; end: number }[]>();
  for (const b of existing) if (!["rejected", "cancelled", "waitlisted"].includes(b.status)) (occupied.get(b.resourceId) ?? occupied.set(b.resourceId, []).get(b.resourceId)!).push(b);
  const managerOf: Record<string, string> = { Mechanical: "u-arun" };

  const people = PEOPLE.map((p) => ({ ...p, id: `u-h-${p.slug.replace(".", "-")}` }));
  const rows: (typeof schema.bookings.$inferInsert)[] = [];
  const incidents: (typeof schema.incidents.$inferInsert)[] = [];
  const held = new Map<string, Booking[]>(); // per user, for the fair-share cap
  let n = 0;
  const newId = () => `h${String(++n).padStart(4, "0")}-${Math.floor(rng() * 1e8).toString(36)}`;

  const eligible = (r: Resource) =>
    people.filter((p) => parseList(r.allowedAffiliations).includes(p.aff) && parseList(r.requiredCerts).every((c) => p.certs.includes(c)));

  for (let d = 60; d >= 1; d--) {
    const day = now - d * DAY;
    const wd = campusParts(day).weekday;
    for (const r of resources) {
      const base = DEMAND[r.id];
      if (!base || r.status !== "active") continue;
      if (!parseList<number>(r.openDays).includes(wd)) continue;
      const weekend = wd === 0 || wd === 6;
      const expected = base * (weekend ? 0.45 : 1) * (d > 45 ? 0.75 : 1); // usage has grown since launch
      const count = Math.floor(expected + rng());
      const pool = eligible(r);
      if (!pool.length) continue;
      for (let k = 0; k < count; k++) {
        const own = pool.filter((p) => p.dept === r.department);
        const person = own.length && rng() < 0.42 ? pick(own) : pick(pool);
        const maxDur = r.maxHours;
        const dur = Math.min(maxDur, r.id === "r-gpu" ? weighted<number>([[2, 2], [3, 2], [4, 3], [6, 2], [8, 1]]) : weighted<number>([[1, 3], [2, 4], [3, 2], [4, 1]]));
        const hours: [number, number][] = [];
        for (let h = r.openHour; h + dur <= r.closeHour; h++) hours.push([h, HOUR_WEIGHT[h] ?? 0.4]);
        if (!hours.length) continue;
        const start = campusDayAt(day, weighted(hours));
        const end = start + dur * HOUR;
        if (end > now - 2 * HOUR) continue;
        const [purposeType, purpose] = pick(PURPOSES[r.id] ?? [["project", "Club project work."]]);
        const createdAt = start - (1 + Math.floor(rng() * 4)) * DAY + Math.floor(rng() * 8) * HOUR;
        const pts = { coursework: 20, research: 15, project: 10, personal: 0 }[purposeType];
        const common = {
          id: newId(),
          resourceId: r.id,
          userId: person.id,
          start,
          end,
          purpose,
          purposeType,
          priorityScore: 50 + pts,
          priorityBreakdown: JSON.stringify([{ label: "Base", points: 50 }, { label: `Purpose: ${purposeType}`, points: pts }]),
          eligibilitySnapshot: JSON.stringify({ eligible: true, checks: [], needsSupervision: r.supervisionRequired }),
          createdAt,
        };

        const slots = occupied.get(r.id) ?? [];
        const mine = held.get(person.id) ?? [];
        const usedThisWeek = mine.filter((b) => b.resourceId === r.id && Math.abs(b.start - start) < 7 * DAY).reduce((h, b) => h + (b.end - b.start) / HOUR, 0);
        if (slots.some((s) => overlaps(s, { start, end }))) {
          // Turned away: the slot was already taken. This is the unmet demand.
          const wait = rng() < 0.6;
          rows.push({
            ...common,
            status: wait ? "waitlisted" : "rejected",
            decisionReason: wait
              ? "This slot overlaps an approved booking. You are on the waiting list and will be moved up automatically if it frees up."
              : "Slot already taken by an approved booking; please pick another time.",
            decidedBy: wait ? null : r.ownerId,
          });
          continue;
        }
        if (usedThisWeek + dur > r.weeklyHourCap) {
          rows.push({ ...common, status: "rejected", decisionReason: `Fair-share weekly cap reached (${r.weeklyHourCap} h on this resource).`, decidedBy: null });
          continue;
        }
        const roll = rng();
        if (roll < 0.04) {
          rows.push({ ...common, status: "cancelled", decisionReason: "Cancelled by requester.", decidedBy: person.id });
          continue;
        }
        if (roll < 0.06 && r.id === "r-laser") {
          rows.push({ ...common, status: "rejected", decisionReason: "PVC and vinyl are not allowed on the laser cutter (toxic fumes). Please use acrylic or MDF.", decidedBy: r.ownerId });
          continue;
        }
        slots.push({ start, end });
        occupied.set(r.id, slots);
        if (roll < 0.085) {
          const row = { ...common, status: "closed" as const, decisionReason: "No-show: the slot ended without a check-in.", decidedBy: r.ownerId };
          rows.push(row);
          continue;
        }
        const late = rng() < 0.09;
        const returnAt = late ? end + (15 + Math.floor(rng() * 80)) * 60_000 : end - Math.floor(rng() * 25) * 60_000;
        const outCond = rng() < 0.3 ? "excellent" : "good";
        const worse = rng() < 0.05;
        const retCond = worse ? (outCond === "excellent" ? "good" : "fair") : outCond;
        const staff = r.supervisionRequired;
        const method = () => (staff ? (rng() < 0.75 ? "staff_code" : "staff_manual") : rng() < 0.85 ? "qr" : "staff_manual");
        const id = common.id;
        const row = {
          ...common,
          status: "closed" as const,
          decisionReason: `Return confirmed. Owner assessed condition: ${retCond[0].toUpperCase()}${retCond.slice(1)}.`,
          decidedBy: r.ownerId,
          checkOutAt: start + Math.floor((rng() * 25 - 10) * 60_000),
          checkOutCondition: outCond,
          checkOutMethod: method(),
          returnAt,
          returnCondition: retCond,
          returnMethod: method(),
          returnConfirmedBy: r.ownerId,
        } satisfies typeof schema.bookings.$inferInsert;
        rows.push(row);
        mine.push(row as unknown as Booking);
        held.set(person.id, mine);
        if (worse || (late && returnAt - end > 60 * 60_000)) {
          incidents.push({
            id: `i-${id}`,
            bookingId: id,
            resourceId: r.id,
            reporterId: r.ownerId,
            subjectUserId: person.id,
            type: worse ? "damage" : "delay",
            severity: "low",
            description: worse
              ? `Condition dropped from ${outCond} to ${retCond} at return (minor wear noted at inspection).`
              : `Returned ${Math.round((returnAt - end) / 60_000)} min late; the next borrower was delayed.`,
            status: "resolved",
            resolution: worse ? "Minor wear, cleaned and back in service. No strike." : "Borrower reminded of return times. No strike for a first delay.",
            strikeIssued: false,
            resolvedBy: managerOf[r.department] ?? "u-kavya",
            createdAt: returnAt + HOUR,
            resolvedAt: returnAt + DAY,
          });
        }
      }
    }
  }

  for (let i = 0; i < rows.length; i += 50) await db.insert(schema.bookings).values(rows.slice(i, i + 50));
  if (incidents.length) await db.insert(schema.incidents).values(incidents);

  // One audit entry for the whole import (the hash chain stays valid; per-booking entries would be noise).
  await audit({
    actorId: null,
    action: "system.history_imported",
    entityType: "system",
    entityId: "history",
    details: { note: "Imported 60 days of booking history (fictional) for the impact dashboard", people: PEOPLE.length, bookings: rows.length, incidents: incidents.length },
  });
}
