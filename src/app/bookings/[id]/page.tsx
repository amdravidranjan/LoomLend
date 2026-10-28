import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { canManageResource, requireUser } from "@/lib/auth";
import { AFFILIATIONS, PURPOSES, conditionRank } from "@/lib/catalog";
import { fmtDateTime, fmtRange, relative } from "@/lib/time";
import { bookingRef, demoMode, isOverdue, sweep, waitlistPosition } from "@/lib/workflow";
import type { Eligibility, PriorityFactor } from "@/lib/rules";
import type { AdvisoryNote } from "@/lib/ai";
import { cancelAction, checkOutAction, confirmReturnAction, decideAction, extendAction, reportIncidentAction, returnAction } from "@/app/actions";
import { ActionForm, ConditionSelect, PhotoInput, Submit } from "@/components/forms";
import { Advisory, Badge, Checks, Condition, Notice, PageHeader, Priority, Section, parseJson } from "@/components/ui";
import { Timeline } from "@/components/timeline";

const STEPS = [
  { key: "requested", label: "Requested" },
  { key: "decided", label: "Reviewed" },
  { key: "out", label: "Checked in" },
  { key: "back", label: "Returned" },
  { key: "closed", label: "Confirmed" },
];

function stepIndex(status: string) {
  return { pending: 0, waitlisted: 0, rejected: 1, cancelled: 1, approved: 1, checked_out: 2, returned: 3, closed: 4 }[status] ?? 0;
}

export default async function BookingPage({ params, searchParams }: PageProps<"/bookings/[id]">) {
  const user = await requireUser();
  await sweep();
  const { id } = await params;
  const sp = await searchParams;
  const b = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, id) });
  if (!b) notFound();
  const r = (await db.query.resources.findFirst({ where: eq(schema.resources.id, b.resourceId) }))!;
  const staff = canManageResource(user, r);
  const mine = b.userId === user.id;
  if (!mine && !staff) notFound(); // privacy: only the two parties (and their managers) see a booking

  const requester = (await db.query.users.findFirst({ where: eq(schema.users.id, b.userId) }))!;
  const decider = b.decidedBy ? await db.query.users.findFirst({ where: eq(schema.users.id, b.decidedBy) }) : null;
  const history = await db.select().from(schema.auditLog).where(eq(schema.auditLog.bookingId, b.id)).orderBy(asc(schema.auditLog.seq));
  const incidents = await db.select().from(schema.incidents).where(eq(schema.incidents.bookingId, b.id));
  const elig = parseJson<Eligibility | null>(b.eligibilitySnapshot, null);
  const factors = parseJson<PriorityFactor[]>(b.priorityBreakdown, []);
  const ai = parseJson<AdvisoryNote | null>(b.aiReview, null);
  const pos = b.status === "waitlisted" ? await waitlistPosition(b) : 0;
  const overdue = isOverdue(b);
  const step = stepIndex(b.status);
  const ended = ["rejected", "cancelled"].includes(b.status);

  return (
    <div className="space-y-6">
      {sp.new && (
        <Notice tone={b.status === "approved" ? "ok" : "info"}>
          {b.status === "approved" ? "Booked! " : b.status === "waitlisted" ? `You are #${pos} on the waiting list. ` : "Request sent. "}
          {b.decisionReason ?? "The owner has been notified and will review it."}
        </Notice>
      )}

      <div>
        <p className="text-sm text-muted">
          <Link href={mine ? "/bookings" : "/manage"} className="hover:underline">← {mine ? "My bookings" : "Manage"}</Link>
        </p>
        <PageHeader kicker={`Booking ${bookingRef(b.id)}`} title={`${r.emoji} ${r.name}`}>
          <div className="flex gap-2">
            {overdue && <Badge status="overdue" label={`Overdue ${relative(b.end).replace(" ago", "")}`} />}
            <Badge status={b.status} label={b.status === "waitlisted" ? `Waiting list #${pos}` : undefined} />
          </div>
        </PageHeader>
      </div>

      <ol className="grid grid-cols-5 gap-1 text-center text-xs" aria-label="Progress">
        {STEPS.map((s, i) => {
          const done = !ended && i <= step && !(b.status === "pending" && i === 1) && !(b.status === "waitlisted" && i === 1);
          const failed = ended && i === 1;
          return (
            <li key={s.key} className="space-y-1">
              <div className={`h-1.5 rounded-full ${failed ? "bg-rose" : done ? "bg-thread" : "bg-line"}`} />
              <span className={done ? "font-semibold" : "text-muted"}>{failed ? (b.status === "rejected" ? "Rejected" : "Cancelled") : s.label}</span>
            </li>
          );
        })}
      </ol>

      {b.decisionReason && !sp.new && (
        <Notice tone={b.status === "rejected" ? "error" : b.status === "waitlisted" ? "info" : "ok"}>
          <strong>Why: </strong>
          {b.decisionReason}
          {decider && <span className="text-xs opacity-80"> · {decider.name}</span>}
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Section title="Request">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div><dt className="label">Slot</dt><dd>{fmtRange(b.start, b.end)}</dd></div>
              <div><dt className="label">Where</dt><dd>{r.location}</dd></div>
              <div><dt className="label">Requester</dt><dd>{requester.name} · {requester.department} · {AFFILIATIONS[requester.affiliation]}{staff && requester.strikes ? ` · ${requester.strikes} strike(s)` : ""}</dd></div>
              <div><dt className="label">Purpose</dt><dd>{PURPOSES[b.purposeType]}</dd></div>
              <div className="sm:col-span-2"><dt className="label">Details</dt><dd className="text-ink/85">{b.purpose}</dd></div>
            </dl>
            <div className="mt-4">
              <Priority score={b.priorityScore} factors={factors} />
            </div>
          </Section>

          {staff && ai && <Advisory note={ai} title="Request notes for the reviewer" />}

          {(b.checkOutAt || b.returnAt) && (
            <Section title="Condition record">
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  { title: "At check-in", at: b.checkOutAt, cond: b.checkOutCondition, notes: b.checkOutNotes, photo: b.checkOutPhoto },
                  { title: "At return", at: b.returnAt, cond: b.returnCondition, notes: b.returnNotes, photo: b.returnPhoto },
                ].map((c) => (
                  <div key={c.title} className="rounded-lg border border-line bg-white p-3 text-sm">
                    <p className="label">{c.title}</p>
                    {c.at ? (
                      <>
                        <p><Condition value={c.cond} /></p>
                        <p className="text-muted">{fmtDateTime(c.at)}</p>
                        {c.notes && <p className="mt-1">{c.notes}</p>}
                        {c.photo && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.photo} alt={`Condition photo ${c.title.toLowerCase()}`} className="mt-2 max-h-48 rounded border border-line" />
                        )}
                      </>
                    ) : (
                      <p className="text-muted">Not yet recorded</p>
                    )}
                  </div>
                ))}
              </div>
              {b.returnAt && conditionRank(b.returnCondition) < conditionRank(b.checkOutCondition) && (
                <p className="mt-3 text-sm text-rose">Condition dropped between check-in and return. A damage report was opened automatically for a manager to review.</p>
              )}
              {b.returnAt && b.returnAt > b.end && <p className="mt-1 text-sm text-saffron">Returned {Math.round((b.returnAt - b.end) / 60000)} min after the slot ended.</p>}
            </Section>
          )}

          {incidents.length > 0 && (
            <Section title="Incidents">
              <ul className="space-y-2 text-sm">
                {incidents.map((i) => (
                  <li key={i.id}>
                    <Link href={`/incidents/${i.id}`} className="flex items-center justify-between gap-2 rounded-md border border-line bg-white p-2 hover:border-thread">
                      <span className="capitalize">{i.type} · {i.severity} severity</span>
                      <Badge status={i.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Activity history" aside={<span className="text-xs text-muted">Visible to both parties · tamper-evident</span>}>
            <Timeline entries={history} />
          </Section>
        </div>

        <div className="space-y-6">
          {staff && ["pending", "waitlisted"].includes(b.status) && (
            <Section title="Your decision">
              {elig && (
                <details className="mb-3 text-sm" open={!elig.eligible}>
                  <summary className="cursor-pointer font-medium">Requirement check at request time: {elig.eligible ? "all met" : "issues"}</summary>
                  <div className="mt-2"><Checks checks={elig.checks} /></div>
                </details>
              )}
              <ActionForm action={decideAction}>
                <input type="hidden" name="bookingId" value={b.id} />
                <div>
                  <label className="label" htmlFor="reason">Reason (shown to the requester; required to reject or waitlist)</label>
                  <textarea id="reason" name="reason" rows={2} className="input" placeholder="e.g. Approved. Bring your own acrylic; supervised by Meena." />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Submit className="btn-ok" name="decision" value="approve">Approve</Submit>
                  {b.status !== "waitlisted" && <Submit className="btn-ghost" name="decision" value="waitlist">Waitlist</Submit>}
                  <Submit className="btn-danger" name="decision" value="reject">Reject</Submit>
                </div>
                <p className="text-xs text-muted">Approving re-checks requirements and conflicts. Competing requests are moved to the waiting list with an explanation.</p>
              </ActionForm>
            </Section>
          )}

          {b.status === "approved" && (mine || staff) && (
            <Section title={r.supervisionRequired ? "Supervised check-in" : "Check in"}>
              {r.supervisionRequired && !staff ? (
                <p className="text-sm">This resource needs staff present. Meet the owner at {r.location}; they inspect it with you and record the check-in.</p>
              ) : (
                <ActionForm action={checkOutAction}>
                  <input type="hidden" name="bookingId" value={b.id} />
                  <p className="text-sm text-muted">Inspect it before you start and record what you see. This protects you if something was already wrong.</p>
                  <ConditionSelect />
                  <div>
                    <label className="label" htmlFor="co-notes">Notes</label>
                    <textarea id="co-notes" name="notes" rows={2} className="input" placeholder="e.g. All probes present, small scratch on the left side." />
                  </div>
                  <PhotoInput />
                  <Submit>{staff && !mine ? (r.supervisionRequired ? "Record supervised check-in" : "Record check-in for borrower") : "Check in now"}</Submit>
                  {demoMode() && <p className="text-xs text-muted">Demo mode: time window relaxed.</p>}
                </ActionForm>
              )}
            </Section>
          )}

          {b.status === "checked_out" && (mine || staff) && (
            <Section title="Return">
              <ActionForm action={returnAction}>
                <input type="hidden" name="bookingId" value={b.id} />
                <p className="text-sm text-muted">Due {fmtDateTime(b.end)}. Record the condition you are returning it in.</p>
                <ConditionSelect defaultValue={b.checkOutCondition ?? "good"} />
                <div>
                  <label className="label" htmlFor="rt-notes">Notes</label>
                  <textarea id="rt-notes" name="notes" rows={2} className="input" placeholder="Anything the owner should know." />
                </div>
                <PhotoInput />
                <Submit>Return it</Submit>
              </ActionForm>
            </Section>
          )}

          {b.status === "returned" && staff && (
            <Section title="Inspect & confirm return">
              <ActionForm action={confirmReturnAction}>
                <input type="hidden" name="bookingId" value={b.id} />
                <p className="text-sm">Borrower says: <Condition value={b.returnCondition} />. What do you see?</p>
                <ConditionSelect defaultValue={b.returnCondition ?? "good"} />
                <div>
                  <label className="label" htmlFor="cf-notes">Inspection notes</label>
                  <textarea id="cf-notes" name="notes" rows={2} className="input" />
                </div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="reportDamage" className="accent-rose" /> Open a damage report for a manager</label>
                <Submit className="btn-ok">Confirm & close</Submit>
              </ActionForm>
            </Section>
          )}
          {b.status === "returned" && mine && !staff && <Notice>Waiting for the owner to inspect and confirm your return.</Notice>}

          {mine && ["approved", "checked_out"].includes(b.status) && (
            <Section title="Need more time?">
              <ActionForm action={extendAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="bookingId" value={b.id} />
                <div>
                  <label className="label" htmlFor="minutes">Extend by</label>
                  <select id="minutes" name="minutes" className="input">
                    <option value="30">30 minutes</option>
                    <option value="60">1 hour</option>
                    <option value="120">2 hours</option>
                  </select>
                </div>
                <Submit className="btn-ghost">Request extension</Submit>
                <p className="w-full text-xs text-muted">Granted automatically only if nobody has the next slot and limits allow; otherwise refused with the reason. Both are logged.</p>
              </ActionForm>
            </Section>
          )}

          {["pending", "approved", "waitlisted"].includes(b.status) && (mine || staff) && (
            <Section title="Cancel">
              <ActionForm action={cancelAction}>
                <input type="hidden" name="bookingId" value={b.id} />
                <input name="reason" className="input" placeholder={mine ? "Reason (optional)" : "Reason for the requester (required)"} />
                <Submit className="btn-ghost">Cancel booking</Submit>
                <p className="text-xs text-muted">Freeing a slot early moves the next person on the waiting list up.</p>
              </ActionForm>
            </Section>
          )}

          {["checked_out", "returned", "closed", "approved"].includes(b.status) && (
            <Section title="Report a problem">
              <ActionForm action={reportIncidentAction}>
                <input type="hidden" name="bookingId" value={b.id} />
                <input type="hidden" name="resourceId" value={r.id} />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label" htmlFor="type">Type</label>
                    <select id="type" name="type" className="input">
                      <option value="damage">Damage</option>
                      <option value="delay">Delay</option>
                      <option value="conflict">Scheduling conflict</option>
                      <option value="safety">Safety</option>
                      <option value="misuse">Misuse</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="severity">Severity</label>
                    <select id="severity" name="severity" className="input">
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                </div>
                <textarea name="description" required minLength={10} rows={3} className="input" placeholder="What happened, when, and what you did about it." aria-label="Description" />
                <Submit className="btn-ghost">File report</Submit>
                <p className="text-xs text-muted">Reports go to the department manager. Only a person can decide fault or penalties.</p>
              </ActionForm>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
