import type { AuditEntry, Booking, Resource, User } from "@/db/schema";
import { conditionRank } from "@/lib/catalog";
import { fmtDateTime, fmtRange } from "@/lib/time";
import { demoMode } from "@/lib/workflow";
import { canManageResource } from "@/lib/auth";
import { liveCode } from "@/lib/handover";
import { METHOD_LABEL, checkInWindow, photoRequired, type HandoverMethod } from "@/lib/handover-rules";
import { parseDiff, visionEnabled } from "@/lib/vision";
import { STALE_PENDING_MS } from "@/lib/vision-types";
import { confirmReturnAction } from "@/app/actions";
import { ActionForm, ConditionSelect, Submit } from "@/components/forms";
import { Condition, Notice, Section } from "@/components/ui";
import { HandoverForm, type FormMethod } from "@/components/handover-form";
import { HandoverCodePanel } from "@/components/handover-code";
import { ConditionCompare } from "@/components/handover-compare";

/** "Verified at the machine via QR tag" etc. */
export function ProofBadge({ method, simulated }: { method: HandoverMethod | null; simulated?: boolean }) {
  if (!method) return <span className="text-xs text-muted">Proof of presence not recorded</span>;
  const tone = simulated ? "border-dashed border-saffron bg-saffron-soft text-saffron" : "border-teal-200 bg-teal-soft text-teal";
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${tone}`}>
      <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M3 8.5l3 3 7-7" />
      </svg>
      {METHOD_LABEL[method]}
      {simulated ? " (simulated, demo)" : ""}
    </span>
  );
}

function simulatedIn(history: AuditEntry[], action: string) {
  const e = [...history].reverse().find((h) => h.action === action);
  if (!e) return false;
  try {
    return Boolean((JSON.parse(e.details) as { simulated?: boolean }).simulated);
  } catch {
    return false;
  }
}

/** Condition record with proof-of-presence badges and the before/after comparison. */
export async function ConditionRecordSection({ b, history, canRetry, now }: { b: Booking; history: AuditEntry[]; canRetry: boolean; now: number }) {
  if (!b.checkOutAt && !b.returnAt) return null;
  const rows = [
    { title: "At check-in", at: b.checkOutAt, cond: b.checkOutCondition, notes: b.checkOutNotes, photo: b.checkOutPhoto, method: b.checkOutMethod, sim: simulatedIn(history, "booking.checked_out") },
    { title: "At return", at: b.returnAt, cond: b.returnCondition, notes: b.returnNotes, photo: b.returnPhoto, method: b.returnMethod, sim: simulatedIn(history, "booking.returned") },
  ];
  const both = Boolean(b.checkOutPhoto && b.returnPhoto);
  return (
    <Section title="Condition record">
      <div className="grid gap-4 sm:grid-cols-2">
        {rows.map((c) => (
          <div key={c.title} className="rounded-lg border border-line bg-white p-3 text-sm">
            <p className="label">{c.title}</p>
            {c.at ? (
              <>
                <p><Condition value={c.cond} /></p>
                <p className="text-muted">{fmtDateTime(c.at)}</p>
                <p className="mt-1"><ProofBadge method={c.method} simulated={c.sim} /></p>
                {c.notes && <p className="mt-1">{c.notes}</p>}
                {c.photo && !both && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.photo} alt={`Condition photo ${c.title.toLowerCase()}`} className="mt-2 max-h-48 rounded border border-line" />
                )}
                {!c.photo && <p className="mt-1 text-xs text-muted">No photo.</p>}
              </>
            ) : (
              <p className="text-muted">Not yet recorded</p>
            )}
          </div>
        ))}
      </div>
      {both && (
        <div className="mt-4">
          <ConditionCompare
            before={b.checkOutPhoto!}
            after={b.returnPhoto!}
            diff={parseDiff(b.aiConditionDiff)}
            bookingId={b.id}
            canRetry={canRetry}
            aiConfigured={(await visionEnabled())}
            staleMs={STALE_PENDING_MS}
            now={now}
          />
        </div>
      )}
      {b.returnAt && conditionRank(b.returnCondition) < conditionRank(b.checkOutCondition) && (
        <p className="mt-3 text-sm text-rose">Condition dropped between check-in and return. A damage report was opened automatically for a manager to review.</p>
      )}
      {b.returnAt && b.returnAt > b.end && <p className="mt-1 text-sm text-saffron">Returned {Math.round((b.returnAt - b.end) / 60000)} min after the slot ended.</p>}
    </Section>
  );
}

/** Check-in, return and confirm-return panels for the booking page. */
export async function HandoverPanel({ b, r, user, handover, now }: { b: Booking; r: Resource; user: User; handover?: string; now: number }) {
  const mine = b.userId === user.id;
  const staffHere = canManageResource(user, r);
  const demo = demoMode();
  const needPhoto = photoRequired(r);
  const out: React.ReactNode[] = [];

  if (handover === "checked_in" && b.status === "checked_out")
    out.push(<Notice key="n" tone="ok">Checked in. Your pick-up condition{b.checkOutPhoto ? " and photo are" : " is"} on record. Return it by {fmtDateTime(b.end)}.</Notice>);
  if (handover === "returned" && ["returned", "closed"].includes(b.status))
    out.push(<Notice key="n" tone="ok">Returned. The owner will inspect and confirm.{b.checkOutPhoto && b.returnPhoto ? " Your photos are being compared automatically." : ""}</Notice>);

  for (const purpose of ["check_out", "return"] as const) {
    const ready = purpose === "check_out" ? b.status === "approved" : b.status === "checked_out";
    if (!ready || (!mine && !staffHere)) continue;
    const title = purpose === "check_out" ? (r.supervisionRequired ? "Supervised check-in" : "Check in") : r.supervisionRequired ? "Supervised return" : "Return";
    const window = purpose === "check_out" ? checkInWindow(b, now, demo) : "open";
    const live = staffHere ? await liveCode(b.id, purpose, now) : null;
    const verb = purpose === "check_out" ? "Check in now" : "Return it";

    let borrowerPart: React.ReactNode = null;
    if (mine) {
      if (window === "early") {
        borrowerPart = <Notice tone="warn">Check-in opens 30 minutes before your slot ({fmtRange(b.start, b.end)}).</Notice>;
      } else if (window === "ended") {
        borrowerPart = <Notice tone="warn">This slot has ended without a check-in.</Notice>;
      } else {
        const methods: FormMethod[] = [];
        if (!r.supervisionRequired && demo) methods.push("qr_demo");
        methods.push("staff_code");
        if (staffHere) methods.push("staff_manual");
        borrowerPart = (
          <HandoverForm
            bookingId={b.id}
            purpose={purpose}
            methods={methods}
            scanHref={r.supervisionRequired ? undefined : "/scan"}
            photoRequired={needPhoto}
            defaultCondition={purpose === "return" ? (b.checkOutCondition ?? "good") : "good"}
            submitLabel={verb}
            intro={
              r.supervisionRequired
                ? `Supervised item: meet staff at ${r.location}. They generate a one-time code on their phone; enter it here with the condition you both see.`
                : purpose === "check_out"
                  ? `At ${r.location}, scan the QR tag on the item. It proves you are there and opens this form with the tag verified.`
                  : `Bring it back to ${r.location} and scan the tag, or ask staff for a code.${b.end < now ? " It is overdue: please return it now." : ""}`
            }
          />
        );
      }
    }

    let staffPart: React.ReactNode = null;
    if (staffHere && !mine) {
      staffPart = (
        <div className="space-y-4">
          <HandoverCodePanel bookingId={b.id} purpose={purpose} liveUntil={live?.expiresAt ?? null} />
          <details className="rounded-lg border border-line bg-white p-3">
            <summary className="min-h-11 cursor-pointer content-center font-medium">Or record it yourself, in person</summary>
            <div className="mt-3">
              <HandoverForm
                bookingId={b.id}
                purpose={purpose}
                methods={["staff_manual"]}
                photoRequired={needPhoto}
                defaultCondition={purpose === "return" ? (b.checkOutCondition ?? "good") : "good"}
                submitLabel={purpose === "check_out" ? "Record check-in for borrower" : "Record return for borrower"}
                intro="Only when you are with the borrower at the item. Recorded as a staff hand-over in the history."
              />
            </div>
          </details>
          {window === "early" && <p className="text-xs text-muted">The borrower&apos;s check-in window opens 30 minutes before the slot.</p>}
        </div>
      );
    }

    out.push(
      <Section key={purpose} title={title} aside={demo ? <span className="text-xs text-muted">Demo mode: time window relaxed</span> : undefined}>
        <div className="space-y-4">
          {borrowerPart}
          {staffPart}
        </div>
      </Section>,
    );
  }

  if (b.status === "returned" && staffHere) {
    out.push(
      <Section key="confirm" title="Inspect & confirm return">
        <ActionForm action={confirmReturnAction}>
          <input type="hidden" name="bookingId" value={b.id} />
          <p className="text-sm">Borrower says: <Condition value={b.returnCondition} />. What do you see?</p>
          {b.checkOutPhoto && b.returnPhoto && <p className="text-xs text-muted">Compare the before/after photos in the condition record before you decide.</p>}
          <ConditionSelect defaultValue={b.returnCondition ?? "good"} />
          <div>
            <label className="label" htmlFor="cf-notes">Inspection notes</label>
            <textarea id="cf-notes" name="notes" rows={2} className="input" />
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="reportDamage" className="size-4 accent-rose" /> Open a damage report for a manager</label>
          <Submit className="btn-ok min-h-11">Confirm & close</Submit>
        </ActionForm>
      </Section>,
    );
  }
  if (b.status === "returned" && mine && !staffHere) out.push(<Notice key="wait">Waiting for the owner to inspect and confirm your return.</Notice>);
  return <>{out}</>;
}
