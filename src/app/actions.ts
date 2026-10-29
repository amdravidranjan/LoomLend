"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db, schema } from "@/db";
import { canManageResource, canReviewCerts, createSession, destroySession, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { CERTS } from "@/lib/catalog";
import { parseCampusLocal } from "@/lib/time";
import { seedDemo, DEMO_ACCOUNTS } from "@/lib/seed";
import * as wf from "@/lib/workflow";
import { newQrSecret } from "@/lib/handover-rules";
import { proofFromForm } from "@/lib/handover";

export type FormState = { error?: string; ok?: string } | undefined;

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
/** Only same-site relative paths, so a crafted ?next= cannot send people to another site. */
const safeNext = (next: string) => (next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/");

async function run(fn: () => Promise<string | void>): Promise<FormState> {
  try {
    const ok = await fn();
    revalidatePath("/", "layout");
    return { ok: ok || "Saved." };
  } catch (e) {
    if (e instanceof wf.WorkflowError) return { error: e.message };
    if (e instanceof z.ZodError) return { error: e.issues.map((i) => i.message).join(" ") };
    throw e;
  }
}

// ---------------------------------------------------------------- auth

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await db.query.users.findFirst({ where: eq(schema.users.email, str(fd, "email").toLowerCase()) });
  if (!user || !(await bcrypt.compare(str(fd, "password"), user.passwordHash))) return { error: "Email or password is incorrect." };
  await createSession(user.id);
  redirect(safeNext(str(fd, "next")));
}

export async function demoLoginAction(fd: FormData) {
  const id = str(fd, "userId");
  if (!DEMO_ACCOUNTS.some((a) => a.id === id)) return;
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
  if (!user) return;
  await createSession(user.id);
  redirect(safeNext(str(fd, "next")));
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}

const registerSchema = z.object({
  name: z.string().min(2, "Enter your name."),
  email: z.string().email("Enter a valid email."),
  password: z.string().min(8, "Password needs at least 8 characters."),
  department: z.string().min(2, "Enter your department or organisation."),
  affiliation: z.enum(["student", "researcher", "staff", "external"]),
});

export async function registerAction(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = registerSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join(" ") };
  const email = parsed.data.email.toLowerCase();
  if (await db.query.users.findFirst({ where: eq(schema.users.email, email) })) return { error: "An account with this email exists." };
  const id = crypto.randomUUID();
  await db.insert(schema.users).values({
    id,
    name: parsed.data.name,
    email,
    passwordHash: await bcrypt.hash(parsed.data.password, 10),
    role: "member",
    department: parsed.data.department,
    affiliation: parsed.data.affiliation,
    idVerified: false,
    createdAt: Date.now(),
  });
  await audit({ actorId: id, action: "user.registered", entityType: "user", entityId: id, details: { affiliation: parsed.data.affiliation } });
  const admins = await db.select().from(schema.users).where(eq(schema.users.role, "admin"));
  for (const a of admins) await notify(a.id, "review", "New account to verify", `${parsed.data.name} (${parsed.data.department}) registered.`, "/admin");
  await createSession(id);
  redirect("/profile?welcome=1");
}

// ---------------------------------------------------------------- resources

const resourceSchema = z.object({
  name: z.string().min(3, "Name is too short."),
  category: z.enum(["space", "equipment", "tool", "device"]),
  emoji: z.string().min(1).max(8),
  description: z.string().min(10, "Add a description."),
  location: z.string().min(3, "Add a location."),
  tags: z.string(),
  usageRules: z.string().min(10, "Add usage rules."),
  openHour: z.coerce.number().int().min(0).max(23),
  closeHour: z.coerce.number().int().min(1).max(24),
  maxHours: z.coerce.number().int().min(1).max(24),
  weeklyHourCap: z.coerce.number().int().min(1).max(80),
  depositRequired: z.coerce.number().int().min(0),
  allocationMode: z.enum(["review", "rounds"]).default("review"),
  roundLeadHours: z.coerce.number().int().min(1, "Draw lead time must be at least 1 hour.").max(168, "Draw lead time can be at most 7 days.").default(24),
});

export async function createResourceAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["owner", "manager", "admin"]);
  const parsed = resourceSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" ") };
  const d = parsed.data;
  if (d.closeHour <= d.openHour) return { error: "Closing hour must be after opening hour." };
  const days = fd.getAll("openDays").map(Number);
  if (!days.length) return { error: "Pick at least one open day." };
  const affiliations = fd.getAll("allowedAffiliations").map(String);
  if (!affiliations.length) return { error: "Choose who may book it." };
  const certs = fd.getAll("requiredCerts").map(String).filter((c) => c in CERTS);
  const supervision = fd.get("supervisionRequired") === "on";
  const id = crypto.randomUUID();
  await db.insert(schema.resources).values({
    id,
    ownerId: user.id,
    department: user.department,
    ...d,
    tags: d.tags.toLowerCase(),
    openDays: JSON.stringify(days),
    allowedAffiliations: JSON.stringify(affiliations),
    requiredCerts: JSON.stringify(certs),
    supervisionRequired: supervision,
    requiresIdVerified: fd.get("requiresIdVerified") === "on",
    autoApprove: fd.get("autoApprove") === "on" && !supervision,
    status: "active",
    qrSecret: newQrSecret(), // printed into the item's QR tag (/resources/[id]/tag)
    createdAt: Date.now(),
  });
  await audit({ actorId: user.id, action: "resource.listed", entityType: "resource", entityId: id, details: { name: d.name, certs, supervision, allocationMode: d.allocationMode } });
  revalidatePath("/", "layout");
  redirect(`/resources/${id}?listed=1`);
}

export async function setResourceStatusAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(async () => {
    const r = await db.query.resources.findFirst({ where: eq(schema.resources.id, str(fd, "resourceId")) });
    if (!r || !canManageResource(user, r)) throw new wf.WorkflowError("Not allowed.");
    const status = z.enum(["active", "maintenance", "retired"]).parse(str(fd, "status"));
    const note = str(fd, "note");
    await db.update(schema.resources).set({ status }).where(eq(schema.resources.id, r.id));
    await audit({ actorId: user.id, action: "resource.status", entityType: "resource", entityId: r.id, details: { from: r.status, to: status, note } });
    if (status !== "active") {
      const affected = await db
        .select()
        .from(schema.bookings)
        .where(and(eq(schema.bookings.resourceId, r.id), eq(schema.bookings.status, "approved")));
      for (const b of affected) {
        if (b.start > Date.now()) await notify(b.userId, "cancelled", `${r.name} is now ${status}`, `Your booking may be affected. ${note}`, `/bookings/${b.id}`);
      }
    }
    return `Status set to ${status}.`;
  });
}

// ---------------------------------------------------------------- bookings

export async function requestBookingAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const start = parseCampusLocal(str(fd, "start"));
  const end = start ? parseCampusLocal(`${str(fd, "start").slice(0, 10)}T${str(fd, "endTime")}`) : null;
  if (!start || !end) return { error: "Pick a date, start and end time." };
  let id = "";
  const res = await run(async () => {
    const out = await wf.requestBooking(user, {
      resourceId: str(fd, "resourceId"),
      start,
      end,
      purposeType: z.enum(["coursework", "research", "project", "personal"]).parse(str(fd, "purposeType")),
      purpose: str(fd, "purpose"),
    });
    id = out.id;
  });
  if (res?.error) return res;
  redirect(`/bookings/${id}?new=1`);
}

export async function decideAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["owner", "manager", "admin"]);
  const decision = z.enum(["approve", "reject", "waitlist"]).parse(str(fd, "decision"));
  return run(async () => {
    await wf.decide(user, str(fd, "bookingId"), decision, str(fd, "reason"));
    return { approve: "Approved. The requester has been notified.", reject: "Rejected with your reason.", waitlist: "Moved to the waiting list." }[decision];
  });
}

export async function cancelAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(async () => {
    await wf.cancelBooking(user, str(fd, "bookingId"), str(fd, "reason"));
    return "Booking cancelled. Anyone waiting for this slot has been moved up.";
  });
}

export async function extendAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const b = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, str(fd, "bookingId")) });
  if (!b) return { error: "Booking not found." };
  const minutes = Number(str(fd, "minutes"));
  if (![30, 60, 120].includes(minutes)) return { error: "Choose an extension." };
  return run(async () => {
    await wf.extendBooking(user, b.id, b.end + minutes * 60_000);
    return `Extended by ${minutes} minutes.`;
  });
}

const conditionFields = (fd: FormData) => {
  const photo = str(fd, "photo");
  if (photo && (!photo.startsWith("data:image/") || photo.length > 1_500_000)) throw new wf.WorkflowError("Photo is invalid or too large.");
  return { condition: str(fd, "condition"), notes: str(fd, "notes"), photo: photo || null };
};

export async function checkOutAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(async () => {
    await wf.checkOut(user, str(fd, "bookingId"), conditionFields(fd), await proofFromForm(fd, str(fd, "bookingId")));
    return "Checked in. Condition at pick-up recorded.";
  });
}

export async function returnAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(async () => {
    await wf.returnResource(user, str(fd, "bookingId"), conditionFields(fd), await proofFromForm(fd, str(fd, "bookingId")));
    return "Return recorded. The owner will inspect and confirm.";
  });
}

export async function confirmReturnAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["owner", "manager", "admin"]);
  return run(async () => {
    await wf.confirmReturn(user, str(fd, "bookingId"), { condition: str(fd, "condition"), notes: str(fd, "notes"), reportDamage: fd.get("reportDamage") === "on" });
    return "Return confirmed and booking closed.";
  });
}

// ---------------------------------------------------------------- incidents

export async function reportIncidentAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  let id = "";
  const res = await run(async () => {
    id = await wf.reportIncident(user, {
      bookingId: str(fd, "bookingId") || null,
      resourceId: str(fd, "resourceId"),
      type: z.enum(["damage", "delay", "conflict", "misuse", "safety", "other"]).parse(str(fd, "type")),
      severity: z.enum(["low", "medium", "high"]).parse(str(fd, "severity")),
      description: str(fd, "description"),
    });
  });
  if (res?.error) return res;
  redirect(`/incidents/${id}`);
}

export async function resolveIncidentAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["manager", "admin"]);
  return run(async () => {
    await wf.resolveIncident(user, str(fd, "incidentId"), {
      resolution: str(fd, "resolution"),
      issueStrike: fd.get("issueStrike") === "on",
      dismiss: str(fd, "outcome") === "dismiss",
      readBothSides: fd.get("readBothSides") === "on",
    });
    return "Incident closed. Everyone involved has been notified.";
  });
}

// ---------------------------------------------------------------- verification

export async function submitCertAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const certKey = str(fd, "certKey");
  const evidence = str(fd, "evidence");
  if (!(certKey in CERTS)) return { error: "Choose a training type." };
  if (evidence.length < 10) return { error: "Describe the evidence (session date, trainer, certificate number)." };
  return run(async () => {
    const existing = await db.query.certifications.findFirst({
      where: and(eq(schema.certifications.userId, user.id), eq(schema.certifications.certKey, certKey)),
    });
    if (existing?.status === "verified") throw new wf.WorkflowError("Already verified.");
    const id = existing?.id ?? crypto.randomUUID();
    if (existing) {
      await db.update(schema.certifications).set({ evidence, status: "pending", reviewNote: null, createdAt: Date.now() }).where(eq(schema.certifications.id, id));
    } else {
      await db.insert(schema.certifications).values({ id, userId: user.id, certKey, evidence, status: "pending", createdAt: Date.now() });
    }
    await audit({ actorId: user.id, action: "cert.submitted", entityType: "certification", entityId: id, details: { cert: certKey } });
    const reviewers = await db.select().from(schema.users).where(eq(schema.users.role, "manager"));
    for (const r of reviewers.filter((r) => r.department === user.department)) {
      await notify(r.id, "review", "Training record to verify", `${user.name}: ${CERTS[certKey].label}`, "/admin");
    }
    return "Submitted. A manager will verify it.";
  });
}

export async function reviewCertAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["manager", "admin"]);
  if (!canReviewCerts(user)) return { error: "Not allowed." };
  const verdict = z.enum(["verified", "rejected"]).parse(str(fd, "verdict"));
  const note = str(fd, "note");
  if (verdict === "rejected" && note.length < 5) return { error: "Give a reason when rejecting." };
  return run(async () => {
    const c = await db.query.certifications.findFirst({ where: eq(schema.certifications.id, str(fd, "certId")) });
    if (!c) throw new wf.WorkflowError("Not found.");
    await db.update(schema.certifications).set({ status: verdict, reviewNote: note || null, reviewedBy: user.id, reviewedAt: Date.now() }).where(eq(schema.certifications.id, c.id));
    await audit({ actorId: user.id, action: verdict === "verified" ? "cert.verified" : "cert.rejected", entityType: "certification", entityId: c.id, details: { cert: c.certKey, subject: c.userId, note } });
    await notify(c.userId, verdict === "verified" ? "approved" : "rejected", `Training ${verdict}: ${CERTS[c.certKey]?.label}`, note || "You can now book resources that need it.", "/profile");
    return `Marked ${verdict}.`;
  });
}

export async function verifyUserAction(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireUser(["admin"]);
  return run(async () => {
    const id = str(fd, "userId");
    const op = str(fd, "op");
    const u = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
    if (!u) throw new wf.WorkflowError("User not found.");
    if (op === "verify") {
      await db.update(schema.users).set({ idVerified: true }).where(eq(schema.users.id, id));
      await audit({ actorId: admin.id, action: "user.id_verified", entityType: "user", entityId: id });
      await notify(id, "approved", "Identity verified", "Your campus ID was verified by the facilities office.", "/profile");
      return `${u.name} verified.`;
    }
    if (op === "reinstate") {
      const note = str(fd, "note");
      if (note.length < 5) throw new wf.WorkflowError("Record why the account is being reinstated.");
      await db.update(schema.users).set({ suspended: false, strikes: 0 }).where(eq(schema.users.id, id));
      await audit({ actorId: admin.id, action: "user.reinstated", entityType: "user", entityId: id, details: { note } });
      await notify(id, "approved", "Booking privileges restored", note, "/profile");
      return `${u.name} reinstated.`;
    }
    if (op === "suspend") {
      const note = str(fd, "note");
      if (note.length < 5) throw new wf.WorkflowError("Record why the account is being suspended.");
      await db.update(schema.users).set({ suspended: true }).where(eq(schema.users.id, id));
      await audit({ actorId: admin.id, action: "user.suspended", entityType: "user", entityId: id, details: { note } });
      await notify(id, "strike", "Booking privileges suspended", note, "/profile");
      return `${u.name} suspended.`;
    }
    throw new wf.WorkflowError("Unknown operation.");
  });
}

export async function markAllReadAction() {
  const user = await requireUser();
  await db.update(schema.notifications).set({ read: true }).where(eq(schema.notifications.userId, user.id));
  revalidatePath("/", "layout");
}

export async function resetDemoAction(): Promise<FormState> {
  const user = await requireUser(["admin"]);
  if (process.env.ALLOW_DEMO_RESET === "false") return { error: "Reset is disabled on this deployment." };
  await seedDemo();
  await createSession(user.id);
  revalidatePath("/", "layout");
  return { ok: "Demo data restored to the starting state." };
}
