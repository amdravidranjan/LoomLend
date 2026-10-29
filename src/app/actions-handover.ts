"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { canManageResource, requireUser } from "@/lib/auth";
import * as wf from "@/lib/workflow";
import * as ho from "@/lib/handover";
import { compareConditionPhotos, parseDiff, visionEnabled } from "@/lib/vision";
import { STALE_PENDING_MS } from "@/lib/vision-types";
import type { FormState } from "@/app/actions";
import type { CodeState } from "@/lib/handover-state";
import { parseTagPayload } from "@/lib/handover-rules";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

async function run(fn: () => Promise<string | void>): Promise<FormState> {
  try {
    const ok = await fn();
    revalidatePath("/", "layout");
    return { ok: ok || "Saved." };
  } catch (e) {
    if (e instanceof wf.WorkflowError) return { error: e.message };
    if (e instanceof z.ZodError) return { error: "Some fields are missing or invalid. Reload the page and try again." };
    throw e;
  }
}

function photoField(fd: FormData, name = "photo") {
  const photo = str(fd, name);
  if (photo && (!/^data:image\/(jpeg|png|webp);base64,/.test(photo) || photo.length > 1_500_000)) throw new wf.WorkflowError("Photo is invalid or too large.");
  return photo || null;
}

// ---------------------------------------------------------------- check-in / return

/**
 * One action for both hand-overs, from the booking page or the scan page. Proof fields:
 * method = qr (+ k) | qr_demo | staff_code (+ code) | staff_manual.
 */
export async function handoverAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const bookingId = str(fd, "bookingId");
  let purpose: "check_out" | "return" = "check_out";
  let compare = false;
  const res = await run(async () => {
    purpose = z.enum(["check_out", "return"]).parse(str(fd, "purpose"));
    const proof = await ho.proofFromForm(fd, bookingId);
    const c = { condition: str(fd, "condition"), notes: str(fd, "notes"), photo: photoField(fd) };
    if (purpose === "check_out") await wf.checkOut(user, bookingId, c, proof);
    else compare = (await wf.returnResource(user, bookingId, c, proof)).comparePhotos;
  });
  if (res?.error) return res;
  // The photo comparison can take a few seconds: run it after the response is sent.
  if (compare) after(() => compareConditionPhotos(bookingId));
  redirect(`/bookings/${bookingId}?handover=${purpose === "check_out" ? "checked_in" : "returned"}`);
}

export async function issueCodeAction(_: CodeState, fd: FormData): Promise<CodeState> {
  const user = await requireUser(["owner", "manager", "admin"]);
  try {
    const purpose = z.enum(["check_out", "return"]).parse(str(fd, "purpose"));
    const { code, expiresAt } = await ho.issueHandoverCode(user, str(fd, "bookingId"), purpose);
    revalidatePath(`/bookings/${str(fd, "bookingId")}`);
    return { code, expiresAt, purpose };
  } catch (e) {
    if (e instanceof wf.WorkflowError) return { error: e.message };
    if (e instanceof z.ZodError) return { error: "Choose check-in or return." };
    throw e;
  }
}

/** Re-run the advisory photo comparison (e.g. after a timeout, or once an API key is configured). */
export async function retryComparisonAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(async () => {
    const b = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, str(fd, "bookingId")) });
    if (!b) throw new wf.WorkflowError("Booking not found.");
    const r = (await db.query.resources.findFirst({ where: eq(schema.resources.id, b.resourceId) }))!;
    if (b.userId !== user.id && !canManageResource(user, r)) throw new wf.WorkflowError("Not allowed.");
    if (!b.checkOutPhoto || !b.returnPhoto) throw new wf.WorkflowError("Both a check-in and a return photo are needed to compare.");
    if (!visionEnabled()) throw new wf.WorkflowError("AI comparison is not configured on this server. The rough pixel check below still works.");
    const prev = parseDiff(b.aiConditionDiff);
    if (prev?.status === "pending" && Date.now() - prev.requestedAt < STALE_PENDING_MS) throw new wf.WorkflowError("A comparison is already running. Give it a few seconds, then reload.");
    const out = await compareConditionPhotos(b.id);
    if (out?.status === "error") throw new wf.WorkflowError(`${out.message} You can try again.`);
    return "Comparison updated.";
  });
}

// ---------------------------------------------------------------- QR tags

export async function rotateTagAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["owner", "manager", "admin"]);
  if (fd.get("confirm") !== "on") return { error: "Tick the box to confirm: the printed tag will stop working." };
  return run(async () => {
    await ho.rotateQrSecret(user, str(fd, "resourceId"));
    return "New tag generated. Print it and replace the old one: the old tag no longer works.";
  });
}

/** "Can't scan?" fallback: the short code printed under the QR. */
export async function manualTagAction(_: FormState, fd: FormData): Promise<FormState> {
  // No sign-in needed here: the item page it opens asks for one.
  const raw = str(fd, "tagCode");
  // Accept a pasted tag URL as well as the printed short code.
  const parsed = parseTagPayload(raw);
  if (parsed) redirect(ho.tagPath(parsed.resourceId, parsed.secret));
  const hit = await ho.resourceByManualCode(raw);
  if (!hit) return { error: "That code does not match any item. Check the 12 characters under the QR (letters and digits, e.g. ABCD-EFGH-JK23), or ask staff." };
  redirect(ho.tagPath(hit.id, hit.secret));
}

// ---------------------------------------------------------------- two-sided incidents

export async function addStatementAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(async () => {
    await ho.addIncidentStatement(user, str(fd, "incidentId"), { body: str(fd, "body"), photo: photoField(fd) });
    return "Your statement was added. Everyone involved has been notified.";
  });
}

export async function appealAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(async () => {
    await ho.appealIncident(user, str(fd, "incidentId"), str(fd, "reason"));
    return "Appeal sent. An administrator will review the decision and you will be notified.";
  });
}

export async function decideAppealAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["admin"]);
  return run(async () => {
    const verdict = z.enum(["upheld", "overturned"]).parse(str(fd, "verdict"));
    await ho.decideAppeal(user, str(fd, "incidentId"), verdict, str(fd, "note"));
    return verdict === "overturned" ? "Appeal accepted. The borrower has been notified." : "Decision upheld. The borrower has been notified.";
  });
}

export async function resolveIncidentWithSidesAction(_: FormState, fd: FormData): Promise<FormState> {
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
