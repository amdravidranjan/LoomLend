import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { canManageResource, requireUser } from "@/lib/auth";
import { AFFILIATIONS, PURPOSES } from "@/lib/catalog";
import { currentTime, fmtRange, relative } from "@/lib/time";
import { bookingRef, isOverdue, sweep, waitlistPosition } from "@/lib/workflow";
import type { Eligibility, PriorityFactor } from "@/lib/rules";
import type { AdvisoryNote } from "@/lib/ai";
import { cancelAction, decideAction, extendAction, reportIncidentAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { ConditionRecordSection, HandoverPanel } from "@/components/handover-sections";
import { Advisory, Badge, Checks, Notice, PageHeader, Priority, Section, parseJson } from "@/components/ui";
import { Timeline } from "@/components/timeline";
import { CopyButton } from "@/components/ds/client";
import { Icon } from "@/components/ds/icons";

export async function generateMetadata({ params }: PageProps<"/bookings/[id]">) {
  const { id } = await params;
  return { title: `Booking ${bookingRef(id)} · LoomLend` };
}

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
  const now = currentTime();

  return (
    <div className="space-y-6">
      {sp.new && (
        <Notice tone={b.status === "approved" ? "ok" : "info"}>
          {b.status === "approved" ? "Booked! " : b.status === "waitlisted" ? `You are #${pos} on the waiting list. ` : "Request sent. "}
          {b.decisionReason ?? "The owner has been notified and will review it."}
        </Notice>
      )}

      <PageHeader
        back={{ href: mine ? "/bookings" : "/manage", label: mine ? "My bookings" : "Manage" }}
        kicker={`Booking ${bookingRef(b.id)}`}
        title={r.name}
      >
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton value={bookingRef(b.id)} showValue label="Copy booking reference" />
          {mine && ["approved", "pending", "waitlisted"].includes(b.status) && b.end > now && (
            <a href={`/api/bookings/${b.id}/ics`} download className="btn-ghost btn-sm">
              <Icon name="calendarPlus" size={14} />
              Add to calendar
            </a>
          )}
          {overdue && <Badge status="overdue" label={`Overdue ${relative(b.end).replace(" ago", "")}`} />}
          <Badge animate status={b.status} label={b.status === "waitlisted" ? `Waiting list #${pos}` : undefined} />
        </div>
      </PageHeader>

      {b.roundId && (
        <p className="-mt-3 text-sm text-muted">
          Decided by a fair draw.{" "}
          <Link href={`/fairness/rounds/${b.roundId}`} className="font-medium text-thread hover:underline">
            See and verify the draw →
          </Link>
        </p>
      )}

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

          <ConditionRecordSection b={b} history={history} canRetry={mine || staff} now={now} />

          {incidents.length > 0 && (
            <Section title="Incidents">
              <ul className="space-y-2 text-sm">
                {incidents.map((i) => (
                  <li key={i.id}>
                    <Link href={`/incidents/${i.id}`} className="flex items-center justify-between gap-2 rounded-md border border-line bg-card p-2 hover:border-thread">
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
                  <Submit
                    className="btn-ghost text-rose"
                    name="decision"
                    value="reject"
                    confirm={{ title: "Reject this request?", body: "The requester sees your reason. Make sure it explains what they could do differently.", confirmLabel: "Reject", tone: "danger" }}
                  >
                    Reject
                  </Submit>
                </div>
                <p className="text-xs text-muted">Approving re-checks requirements and conflicts. Competing requests are moved to the waiting list with an explanation.</p>
              </ActionForm>
            </Section>
          )}

          <HandoverPanel b={b} r={r} user={user} handover={typeof sp.handover === "string" ? sp.handover : undefined} now={now} />

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
                <Submit
                  className="btn-ghost"
                  confirm={{ title: "Cancel this booking?", body: "Your slot goes to the next person on the waiting list. This can't be undone.", confirmLabel: "Cancel booking", cancelLabel: "Keep it", tone: "danger" }}
                >
                  Cancel booking
                </Submit>
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
