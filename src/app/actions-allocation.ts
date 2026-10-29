"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { canManageResource, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { WorkflowError } from "@/lib/workflow";
import { confirmWinners, overrideWinner, runDrawNow } from "@/lib/allocation";
import type { FormState } from "@/app/actions";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

async function run(fn: () => Promise<string>): Promise<FormState> {
  try {
    const ok = await fn();
    revalidatePath("/", "layout");
    return { ok };
  } catch (e) {
    if (e instanceof WorkflowError) return { error: e.message };
    if (e instanceof z.ZodError) return { error: e.issues.map((i) => i.message).join(" ") };
    throw e;
  }
}

export async function runDrawNowAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["owner", "manager", "admin"]);
  return run(async () => {
    const { winners, entries } = await runDrawNow(user, str(fd, "roundId"));
    return entries
      ? `Draw complete: ${winners} winner(s) from ${entries} entries. The seed is revealed and everyone has been told why. Confirm the winners below.`
      : "Draw complete. Nobody had entered this round.";
  });
}

export async function confirmWinnersAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["owner", "manager", "admin"]);
  return run(async () => {
    const { ok, failed } = await confirmWinners(user, str(fd, "roundId"));
    return failed.length ? `Confirmed ${ok}. Could not confirm ${failed.length}: ${failed.join(" ")}` : `Confirmed ${ok} winner(s). They have been notified.`;
  });
}

export async function overrideWinnerAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["owner", "manager", "admin"]);
  return run(async () => {
    const { promoted } = await overrideWinner(user, str(fd, "bookingId"), str(fd, "reason"));
    return promoted
      ? `Overridden. ${promoted} entr${promoted === 1 ? "y" : "ies"} next in the published draw order moved up for your confirmation.`
      : "Overridden. Nobody else in the draw could use that slot.";
  });
}

const modeSchema = z.object({
  allocationMode: z.enum(["review", "rounds"]),
  roundLeadHours: z.coerce.number().int().min(1, "Lead time must be at least 1 hour.").max(168, "Lead time can be at most 7 days."),
});

/** Owner switches an existing listing between reviewed requests and fair-draw rounds. */
export async function setAllocationModeAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["owner", "manager", "admin"]);
  return run(async () => {
    const r = await db.query.resources.findFirst({ where: eq(schema.resources.id, str(fd, "resourceId")) });
    if (!r || !canManageResource(user, r)) throw new WorkflowError("Not allowed.");
    const d = modeSchema.parse(Object.fromEntries(fd));
    await db.update(schema.resources).set(d).where(eq(schema.resources.id, r.id));
    await audit({ actorId: user.id, action: "resource.updated", entityType: "resource", entityId: r.id, details: { allocationMode: d.allocationMode, roundLeadHours: d.roundLeadHours } });
    return d.allocationMode === "rounds"
      ? `Fair-draw rounds on. Requests for a day close ${d.roundLeadHours} h before it starts and are drawn by weighted lottery.`
      : "Back to owner review: requests are decided one by one.";
  });
}
