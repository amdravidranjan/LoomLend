import "server-only";
import bcrypt from "bcryptjs";
import { db, schema } from "@/db";
import type { Booking } from "@/db/schema";
import { audit } from "./audit";
import { priorityScore } from "./rules";
import { ruleRequestNote } from "./ai";
import { DAY, HOUR, campusDayAt, campusParts } from "./time";

// Entirely fictional demo data for "Northfield Institute of Technology".
export const DEMO_PASSWORD = "demo1234";

export const DEMO_ACCOUNTS = [
  { id: "u-kavya", name: "Kavya Raman", email: "kavya@northfield.demo", role: "admin", department: "Facilities", affiliation: "staff", blurb: "Facilities office · verifies IDs, resolves disputes, sees full audit" },
  { id: "u-arun", name: "Dr. Arun Prakash", email: "arun@northfield.demo", role: "manager", department: "Mechanical", affiliation: "staff", blurb: "HoD Mechanical · verifies training, resolves incidents" },
  { id: "u-meena", name: "Meena Sundar", email: "meena@northfield.demo", role: "owner", department: "Mechanical", affiliation: "staff", blurb: "Fab Lab in-charge · owns laser cutter, 3D printers" },
  { id: "u-rahul", name: "Rahul Dev", email: "rahul@northfield.demo", role: "owner", department: "ECE", affiliation: "staff", blurb: "Electronics lab in-charge · oscilloscopes, GPU box" },
  { id: "u-nisha", name: "Nisha Thomas", email: "nisha@northfield.demo", role: "owner", department: "Media Studies", affiliation: "staff", blurb: "AV studio coordinator · cameras, podcast studio" },
  { id: "u-sanjay", name: "Dr. Sanjay Rao", email: "sanjay@northfield.demo", role: "owner", department: "Chemistry", affiliation: "staff", blurb: "Chemistry lab in-charge · fume hoods" },
  { id: "u-priya", name: "Priya Natarajan", email: "priya@northfield.demo", role: "member", department: "ECE", affiliation: "student", blurb: "3rd-year ECE · fully trained, good record" },
  { id: "u-arjun", name: "Arjun Kumar", email: "arjun@northfield.demo", role: "member", department: "Mechanical", affiliation: "student", blurb: "2nd-year Mech · laser training awaiting verification" },
  { id: "u-divya", name: "Divya Menon", email: "divya@northfield.demo", role: "member", department: "Mechanical", affiliation: "student", blurb: "Final-year Mech · capstone project" },
  { id: "u-farhan", name: "Farhan Ali", email: "farhan@northfield.demo", role: "member", department: "Mechanical", affiliation: "student", blurb: "Has 1 strike · lower priority on busy slots" },
  { id: "u-sneha", name: "Sneha Reddy", email: "sneha@northfield.demo", role: "member", department: "Chemistry", affiliation: "researcher", blurb: "PhD researcher · chemistry-trained" },
  { id: "u-vikram", name: "Vikram Shah", email: "vikram@northfield.demo", role: "member", department: "Incubation Cell", affiliation: "external", blurb: "Startup founder · ID not yet verified" },
] as const;

const CERTS: [string, string, "verified" | "pending"][] = [
  ["u-priya", "lab-safety", "verified"],
  ["u-priya", "electronics", "verified"],
  ["u-priya", "laser-cutter", "verified"],
  ["u-priya", "3d-printer", "verified"],
  ["u-arjun", "lab-safety", "verified"],
  ["u-arjun", "3d-printer", "verified"],
  ["u-arjun", "laser-cutter", "pending"],
  ["u-divya", "lab-safety", "verified"],
  ["u-divya", "laser-cutter", "verified"],
  ["u-divya", "3d-printer", "verified"],
  ["u-farhan", "lab-safety", "verified"],
  ["u-farhan", "laser-cutter", "verified"],
  ["u-farhan", "av-studio", "verified"],
  ["u-sneha", "lab-safety", "verified"],
  ["u-sneha", "chem-safety", "verified"],
];

const STUDENTS = '["student","researcher","staff"]';
const WEEK = "[1,2,3,4,5]";

const RESOURCES = [
  { id: "r-laser", ownerId: "u-meena", name: "Laser Cutter · Epilog Fusion 40W", category: "equipment", emoji: "🔥", department: "Mechanical", location: "Fab Lab, Room M-104, Mechanical Block", tags: "laser,cut,engrave,acrylic,plywood,fabrication,prototype,signage", description: "CO₂ laser cutter for acrylic, plywood (≤6 mm) and cardboard. Bed 600 × 300 mm. Ideal for enclosures, signage and quick prototypes.", requiredCerts: '["lab-safety","laser-cutter"]', supervisionRequired: true, depositRequired: 500, openHour: 10, closeHour: 17, openDays: WEEK, maxHours: 2, weeklyHourCap: 4, usageRules: "Never leave the laser running unattended. PVC and vinyl are banned (toxic fumes). Extraction must be on. Staff supervise check-in.", autoApprove: false, allowedAffiliations: STUDENTS },
  { id: "r-printer", ownerId: "u-meena", name: "3D Printer · Prusa MK4 #2", category: "equipment", emoji: "🧊", department: "Mechanical", location: "Fab Lab, Room M-104", tags: "3d,print,pla,petg,prototype,model,fabrication,part", description: "FDM printer, 250 × 210 × 220 mm. PLA and PETG filament provided for coursework up to 200 g.", requiredCerts: '["3d-printer"]', supervisionRequired: false, depositRequired: 0, openHour: 9, closeHour: 19, openDays: "[1,2,3,4,5,6]", maxHours: 6, weeklyHourCap: 12, usageRules: "Stay for the first layer. Remove your print and clean the bed. Log filament used.", autoApprove: false, allowedAffiliations: STUDENTS },
  { id: "r-toolkit", ownerId: "u-meena", name: "Power Tool Kit · Drill, Jigsaw, Sander", category: "tool", emoji: "🛠️", department: "Mechanical", location: "Fab Lab tool cage, M-104", tags: "drill,jigsaw,sander,wood,tools,build,workshop,diy", description: "Cordless drill-driver, jigsaw and orbital sander with two batteries. For use inside the Fab Lab only.", requiredCerts: '["lab-safety"]', supervisionRequired: false, depositRequired: 0, openHour: 9, closeHour: 18, openDays: WEEK, maxHours: 4, weeklyHourCap: 8, usageRules: "Eye protection required. Return batteries to the charger.", autoApprove: true, allowedAffiliations: STUDENTS },
  { id: "r-scope", ownerId: "u-rahul", name: "Digital Oscilloscope · Rigol DS1104Z", category: "device", emoji: "📈", department: "ECE", location: "Electronics Lab, Room E-201, ECE Block", tags: "oscilloscope,signal,electronics,circuit,debug,measurement,waveform", description: "4-channel 100 MHz scope with probes. Bench use in E-201.", requiredCerts: '["electronics"]', supervisionRequired: false, depositRequired: 0, openHour: 9, closeHour: 18, openDays: WEEK, maxHours: 4, weeklyHourCap: 8, usageRules: "Use the isolation transformer for mains work. Return probes to the hooks.", autoApprove: false, allowedAffiliations: STUDENTS },
  { id: "r-solder", ownerId: "u-rahul", name: "Soldering Station · Hakko FX-888D", category: "tool", emoji: "🔌", department: "ECE", location: "Electronics Lab, E-201, bench 4", tags: "solder,pcb,electronics,repair,circuit,kit", description: "Temperature-controlled soldering station with fume extractor and helping hands.", requiredCerts: '["electronics"]', supervisionRequired: false, depositRequired: 0, openHour: 9, closeHour: 18, openDays: WEEK, maxHours: 3, weeklyHourCap: 9, usageRules: "Switch off and tin the tip when done. Extractor on at all times.", autoApprove: true, allowedAffiliations: STUDENTS },
  { id: "r-gpu", ownerId: "u-rahul", name: "GPU Workstation · RTX 4090, 64 GB", category: "device", emoji: "🖥️", department: "ECE", location: "AI Lab, Room E-310", tags: "gpu,machine learning,ml,ai,deep learning,training,compute,render,cuda", description: "Linux workstation for model training and rendering. Personal home directory wiped after each session.", requiredCerts: "[]", supervisionRequired: false, depositRequired: 0, openHour: 8, closeHour: 22, openDays: "[0,1,2,3,4,5,6]", maxHours: 8, weeklyHourCap: 16, usageRules: "No crypto mining. Save outputs to your own storage; local disk is wiped.", autoApprove: false, allowedAffiliations: STUDENTS },
  { id: "r-camera", ownerId: "u-nisha", name: "Mirrorless Camera Kit · Sony A7 IV", category: "equipment", emoji: "📷", department: "Media Studies", location: "Media Studies store, Room A-12", tags: "camera,photo,video,film,shoot,documentary,lens,content", description: "Body, 24-70 mm f/2.8 lens, 2 batteries, 128 GB card, gimbal. Can be taken around campus.", requiredCerts: '["av-studio"]', supervisionRequired: false, depositRequired: 2000, openHour: 9, closeHour: 18, openDays: WEEK, maxHours: 8, weeklyHourCap: 16, usageRules: "Stays on campus. Lens cap on when not shooting. Wipe your footage from the card on return.", autoApprove: false, allowedAffiliations: STUDENTS },
  { id: "r-studio", ownerId: "u-nisha", name: "Podcast & AV Studio", category: "space", emoji: "🎙️", department: "Media Studies", location: "Media Block, Room A-10", tags: "podcast,audio,record,studio,interview,video,soundproof", description: "Acoustically treated room, 4 mics, mixer, two-camera setup, green screen.", requiredCerts: '["av-studio"]', supervisionRequired: false, depositRequired: 0, openHour: 9, closeHour: 20, openDays: "[1,2,3,4,5,6]", maxHours: 3, weeklyHourCap: 6, usageRules: "No food or drink. Reset the mixer to defaults.", autoApprove: false, allowedAffiliations: STUDENTS },
  { id: "r-hall", ownerId: "u-kavya", name: "Seminar Hall B · 60 seats", category: "space", emoji: "🏛️", department: "Facilities", location: "Admin Block, 2nd floor", tags: "seminar,hall,talk,workshop,event,presentation,projector,classroom,meeting", description: "Projector, PA system, whiteboards. Good for club workshops and talks.", requiredCerts: "[]", supervisionRequired: false, depositRequired: 0, openHour: 8, closeHour: 20, openDays: "[1,2,3,4,5,6]", maxHours: 3, weeklyHourCap: 6, usageRules: "Leave the hall as you found it. Events with outside guests need prior notice to security.", autoApprove: true, allowedAffiliations: STUDENTS },
  { id: "r-meeting", ownerId: "u-kavya", name: "Incubation Cell Meeting Room", category: "space", emoji: "🤝", department: "Facilities", location: "Incubation Cell, Ground floor, Library Annexe", tags: "meeting,room,startup,pitch,discussion,video call,whiteboard", description: "8-seat room with screen and video-conference kit. Open to incubated startups.", requiredCerts: "[]", supervisionRequired: false, depositRequired: 0, openHour: 9, closeHour: 19, openDays: WEEK, maxHours: 2, weeklyHourCap: 4, usageRules: "Book only what you use; release the room if plans change.", autoApprove: true, allowedAffiliations: '["student","researcher","staff","external"]', requiresIdVerified: false },
  { id: "r-hood", ownerId: "u-sanjay", name: "Fume Hood Bay 2", category: "space", emoji: "⚗️", department: "Chemistry", location: "Chemistry Research Lab, C-305", tags: "fume hood,chemistry,synthesis,lab,reaction,solvent,wet lab", description: "Ducted fume hood with gas, vacuum and a stocked spill kit.", requiredCerts: '["lab-safety","chem-safety"]', supervisionRequired: true, depositRequired: 0, openHour: 9, closeHour: 17, openDays: WEEK, maxHours: 4, weeklyHourCap: 8, usageRules: "Lab coat, goggles and gloves. Log every chemical in the hood register. Never work alone.", autoApprove: false, allowedAffiliations: '["researcher","staff"]' },
  { id: "r-drone", ownerId: "u-meena", name: "Survey Drone · DJI Mini 4 Pro", category: "device", emoji: "🛸", department: "Mechanical", location: "Fab Lab, M-104 (cabinet 3)", tags: "drone,aerial,survey,mapping,video,photo", description: "Sub-250 g drone with 3 batteries. Currently in for a gimbal repair.", requiredCerts: '["drone"]', supervisionRequired: true, depositRequired: 3000, openHour: 9, closeHour: 17, openDays: WEEK, maxHours: 3, weeklyHourCap: 6, usageRules: "Campus no-fly zones apply. Pre-flight checklist every time.", autoApprove: false, allowedAffiliations: STUDENTS, status: "maintenance" },
] as const;

/** Next weekday (Mon–Fri) at least `offset` days away, at `hour` campus time. */
function weekday(offset: number, hour: number, now: number) {
  let t = now + offset * DAY;
  while (![1, 2, 3, 4, 5].includes(campusParts(t).weekday)) t += DAY;
  return campusDayAt(t, hour);
}

export async function seedDemo() {
  const now = Date.now();
  for (const t of [schema.handoverCodes, schema.allocationRounds, schema.fairnessCredits, schema.incidentStatements, schema.auditLog, schema.notifications, schema.incidents, schema.bookings, schema.resources, schema.certifications, schema.users]) {
    await db.delete(t);
  }

  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  for (const a of DEMO_ACCOUNTS) {
    await db.insert(schema.users).values({
      id: a.id,
      name: a.name,
      email: a.email,
      passwordHash: hash,
      role: a.role,
      department: a.department,
      affiliation: a.affiliation,
      idVerified: a.id !== "u-vikram",
      strikes: a.id === "u-farhan" ? 1 : 0,
      createdAt: now - 60 * DAY,
    });
  }
  for (const [userId, certKey, status] of CERTS) {
    await db.insert(schema.certifications).values({
      id: `c-${userId}-${certKey}`,
      userId,
      certKey,
      status,
      evidence: status === "pending" ? "Attended the hands-on session with Meena Sundar on 21 Oct; attendance sheet #14." : "Induction record from the department register.",
      reviewedBy: status === "verified" ? "u-arun" : null,
      reviewedAt: status === "verified" ? now - 40 * DAY : null,
      createdAt: now - 45 * DAY,
    });
  }
  for (const r of RESOURCES) {
    await db.insert(schema.resources).values({ requiresIdVerified: true, status: "active", ...r, createdAt: now - 50 * DAY });
    await audit({ actorId: r.ownerId, action: "resource.listed", entityType: "resource", entityId: r.id, details: { name: r.name }, at: now - 50 * DAY });
  }

  const users = await db.select().from(schema.users);
  const userOf = (id: string) => users.find((u) => u.id === id)!;
  const made: Booking[] = [];

  async function booking(
    id: string,
    userId: string,
    resourceId: string,
    start: number,
    end: number,
    purposeType: Booking["purposeType"],
    purpose: string,
    status: Booking["status"],
    extra: Partial<Booking> = {},
  ) {
    const createdAt = Math.min(now, start) - 2 * DAY;
    const res = RESOURCES.find((r) => r.id === resourceId)!;
    const { score, factors } = priorityScore({ purposeType, createdAt, resourceId }, userOf(userId), made, createdAt);
    const row = {
      id,
      userId,
      resourceId,
      start,
      end,
      purposeType,
      purpose,
      status,
      priorityScore: score,
      priorityBreakdown: JSON.stringify(factors),
      eligibilitySnapshot: JSON.stringify({ eligible: true, checks: [], needsSupervision: false }),
      aiReview: JSON.stringify(
        ruleRequestNote({
          resource: { ...res, category: res.category },
          requester: {
            affiliation: userOf(userId).affiliation,
            department: userOf(userId).department,
            strikes: userOf(userId).strikes,
            pastBookings: made.filter((m) => m.userId === userId && m.status === "closed").length,
            pastIncidents: userId === "u-farhan" && resourceId !== "r-camera" ? 1 : 0,
          },
          purposeType,
          purpose,
          hours: (end - start) / HOUR,
          failedChecks: [],
          competingRequests: made.filter((m) => m.resourceId === resourceId && m.start < end && start < m.end).length,
        }),
      ),
      createdAt,
      ...extra,
    } as Booking;
    await db.insert(schema.bookings).values(row);
    made.push(row);
    await audit({ actorId: userId, action: "booking.requested", entityType: "booking", entityId: id, details: { resource: resourceId }, at: createdAt });
    return row;
  }

  // 1. A finished loan with the full trail.
  const s1 = weekday(-6, 10, now);
  await booking("a7f3c1-scope", "u-priya", "r-scope", s1, s1 + 3 * HOUR, "coursework", "Debugging the PWM motor driver for the Embedded Systems lab (EC6301), need to look at gate signals.", "closed", {
    decisionReason: "Return confirmed. Owner assessed condition: Good.",
    decidedBy: "u-rahul",
    checkOutAt: s1 + 5 * 60_000,
    checkOutCondition: "good",
    checkOutNotes: "All 4 probes present, one probe tip slightly bent.",
    returnAt: s1 + 3 * HOUR - 10 * 60_000,
    returnCondition: "good",
    returnNotes: "Probes back on hooks.",
    returnConfirmedBy: "u-rahul",
  });
  await audit({ actorId: "u-rahul", action: "booking.approved", entityType: "booking", entityId: "a7f3c1-scope", details: { reason: "Coursework, trained, slot free." }, at: s1 - DAY });
  await audit({ actorId: "u-priya", action: "booking.checked_out", entityType: "booking", entityId: "a7f3c1-scope", details: { condition: "good" }, at: s1 + 5 * 60_000 });
  await audit({ actorId: "u-priya", action: "booking.returned", entityType: "booking", entityId: "a7f3c1-scope", details: { condition: "good", minutesLate: 0 }, at: s1 + 3 * HOUR - 10 * 60_000 });
  await audit({ actorId: "u-rahul", action: "booking.return_confirmed", entityType: "booking", entityId: "a7f3c1-scope", details: { ownerCondition: "good" }, at: s1 + 3 * HOUR });

  // 2. A camera loan that came back with damage: open incident for the manager.
  const s2 = weekday(-4, 11, now);
  await booking("c4e9d2-camera", "u-farhan", "r-camera", s2, s2 + 5 * HOUR, "project", "Shooting a short documentary on campus recycling for the Green Club.", "returned", {
    decisionReason: "Approved by the resource owner.",
    decidedBy: "u-nisha",
    checkOutAt: s2,
    checkOutCondition: "excellent",
    checkOutNotes: "Lens clean, both batteries charged.",
    returnAt: s2 + 5 * HOUR + 50 * 60_000,
    returnCondition: "fair",
    returnNotes: "Lens hood got scratched when the gimbal tipped over.",
  });
  await audit({ actorId: "u-nisha", action: "booking.approved", entityType: "booking", entityId: "c4e9d2-camera", at: s2 - DAY });
  await audit({ actorId: "u-farhan", action: "booking.checked_out", entityType: "booking", entityId: "c4e9d2-camera", details: { condition: "excellent" }, at: s2 });
  await audit({ actorId: "u-farhan", action: "booking.returned", entityType: "booking", entityId: "c4e9d2-camera", details: { condition: "fair", minutesLate: 50 }, at: s2 + 5 * HOUR + 50 * 60_000 });
  await db.insert(schema.incidents).values({
    id: "i-camera",
    bookingId: "c4e9d2-camera",
    resourceId: "r-camera",
    reporterId: "u-farhan",
    subjectUserId: "u-farhan",
    type: "damage",
    severity: "medium",
    description: 'Condition dropped from "Excellent" at pick-up to "Fair" at return. Borrower notes: lens hood scratched when the gimbal tipped over. Returned 50 min late.',
    aiSummary: JSON.stringify({ source: "rules", summary: "Damage report on the Sony A7 IV kit: lens hood scratched during a gimbal tip-over; returned 50 minutes late.", risk: "medium", flags: ['Condition changed from "excellent" at pick-up to "fair" at return', "Returned 50 min late"] }),
    status: "open",
    createdAt: s2 + 5 * HOUR + 51 * 60_000,
  });
  await audit({ actorId: null, action: "incident.reported", entityType: "incident", entityId: "i-camera", bookingId: "c4e9d2-camera", details: { type: "damage", severity: "medium", autoFlagged: true }, at: s2 + 5 * HOUR + 51 * 60_000 });

  // 3. In use right now and overdue (the sweep will flag it).
  await booking("e2b8f5-printer", "u-arjun", "r-printer", now - 5 * HOUR, now - 1 * HOUR, "coursework", "Printing gearbox housing for the Machine Design assignment (ME5102).", "checked_out", {
    decisionReason: "Approved by the resource owner.",
    decidedBy: "u-meena",
    checkOutAt: now - 5 * HOUR,
    checkOutCondition: "good",
    checkOutNotes: "Bed clean, PLA spool ~60% full.",
  });
  await audit({ actorId: "u-meena", action: "booking.approved", entityType: "booking", entityId: "e2b8f5-printer", at: now - 2 * DAY });
  await audit({ actorId: "u-arjun", action: "booking.checked_out", entityType: "booking", entityId: "e2b8f5-printer", details: { condition: "good" }, at: now - 5 * HOUR });

  // 4. Laser cutter: an approved slot, plus a waiting list entry for it.
  const s4 = weekday(1, 10, now);
  await booking("f1d6a9-laser", "u-priya", "r-laser", s4, s4 + 2 * HOUR, "coursework", "Cutting acrylic enclosure panels for the IoT weather station (EC6702 mini project).", "approved", {
    decisionReason: "Approved by the resource owner. All requirements were met.",
    decidedBy: "u-meena",
  });
  await audit({ actorId: "u-meena", action: "booking.approved", entityType: "booking", entityId: "f1d6a9-laser", at: now - DAY });
  await booking("9c3e7b-laser", "u-farhan", "r-laser", s4 + HOUR, s4 + 2 * HOUR, "personal", "Engraving a name plate for my desk.", "waitlisted", {
    decisionReason: "Another request for an overlapping slot was approved. You are on the waiting list and will move up if the slot frees.",
    decidedBy: "u-meena",
  });
  await audit({ actorId: "u-meena", action: "booking.waitlisted", entityType: "booking", entityId: "9c3e7b-laser", at: now - DAY });

  // 5. Two competing requests waiting for the owner, to show priority ordering.
  const s5 = weekday(2, 13, now);
  await booking("d8a2f4-laser", "u-divya", "r-laser", s5, s5 + 2 * HOUR, "coursework", "Final-year capstone: laser-cutting plywood ribs for the solar dryer prototype.", "pending");
  await booking("b5e1c7-laser", "u-farhan", "r-laser", s5 + HOUR, s5 + 3 * HOUR, "personal", "Want to try cutting a phone stand design I made.", "pending");

  // 6. A supervised fume hood request.
  const s6 = weekday(1, 14, now);
  await booking("7a4d9e-hood", "u-sneha", "r-hood", s6, s6 + 3 * HOUR, "research", "Recrystallisation of a ligand intermediate for my PhD synthesis work (needs solvent handling under extraction).", "pending");

  // 7. An auto-approved seminar hall booking.
  const s7 = weekday(3, 15, now);
  await booking("3f6b2a-hall", "u-divya", "r-hall", s7, s7 + 2 * HOUR, "project", "Robotics club intro workshop for first-years.", "approved", {
    decisionReason: "Auto-approved: the owner allows instant booking for this low-risk resource, all requirements were met and there was no competing request.",
  });
  await audit({ actorId: null, action: "booking.auto_approved", entityType: "booking", entityId: "3f6b2a-hall", details: { rule: "owner auto-approve" }, at: now - DAY });

  // Pending training record
  await audit({ actorId: "u-arjun", action: "cert.submitted", entityType: "certification", entityId: "c-u-arjun-laser-cutter", details: { cert: "laser-cutter" }, at: now - 3 * DAY });

  const n = (userId: string, kind: string, title: string, body: string, link: string, ago: number) =>
    db.insert(schema.notifications).values({ id: crypto.randomUUID(), userId, kind, title, body, link, read: false, createdAt: now - ago });
  await n("u-priya", "approved", "Approved: Laser Cutter · Epilog Fusion 40W", "Approved by the resource owner. Supervised check-in with Meena.", "/bookings/f1d6a9-laser", DAY);
  await n("u-farhan", "waitlisted", "Waiting list #1: Laser Cutter · Epilog Fusion 40W", "Another request for an overlapping slot was approved.", "/bookings/9c3e7b-laser", DAY);
  await n("u-meena", "review", "2 competing requests for the Laser Cutter", "Divya Menon and Farhan Ali want overlapping slots. Priority scores are shown.", "/manage", 2 * DAY);
  await n("u-nisha", "incident", "Incident on Mirrorless Camera Kit", "damage · medium severity. Needs human review.", "/incidents/i-camera", 3 * DAY);
  await n("u-arun", "review", "Training record to verify", "Arjun Kumar submitted Laser Cutter Operator.", "/admin", 3 * DAY);

  await audit({ actorId: null, action: "system.reset", entityType: "system", entityId: "seed", details: { note: "Demo data loaded" } });
}
