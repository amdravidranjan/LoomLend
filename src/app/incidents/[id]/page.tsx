import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { canManageResource, requireUser } from "@/lib/auth";
import { STRIKE_LIMIT } from "@/lib/catalog";
import { currentTime, fmtDateTime, relative } from "@/lib/time";
import { bookingRef } from "@/lib/workflow";
import { appealState, borrowerNotifiedAt, statementRole } from "@/lib/handover";
import { parseDiff, visionEnabled } from "@/lib/vision";
import { STALE_PENDING_MS } from "@/lib/vision-types";
import type { AdvisoryNote } from "@/lib/ai";
import { addStatementAction, appealAction, decideAppealAction, resolveIncidentWithSidesAction } from "@/app/actions-handover";
import { ActionForm, Submit } from "@/components/forms";
import { Advisory, Badge, Condition, Notice, PageHeader, Section, parseJson } from "@/components/ui";
import { Timeline } from "@/components/timeline";
import { ConditionCompare } from "@/components/handover-compare";
import { HandoverPhotoInput } from "@/components/handover-photo";
import { ProofBadge } from "@/components/handover-sections";

const ROLE_STYLE = {
  borrower: { label: "Borrower", chip: "bg-saffron-soft text-saffron", side: "sm:mr-10" },
  owner: { label: "Owner", chip: "bg-thread-soft text-thread", side: "sm:ml-10" },
  manager: { label: "Manager", chip: "bg-teal-soft text-teal", side: "sm:ml-10" },
  witness: { label: "Reporter", chip: "bg-zinc-100 text-zinc-700", side: "sm:ml-10" },
  system: { label: "Automatic report", chip: "bg-zinc-100 text-zinc-700", side: "" },
} as const;

function initials(name: string) {
  return name
    .replace(/^Dr\.?\s+/, "")
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default async function IncidentPage({ params }: PageProps<"/incidents/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const inc = await db.query.incidents.findFirst({ where: eq(schema.incidents.id, id) });
  if (!inc) notFound();
  const r = (await db.query.resources.findFirst({ where: eq(schema.resources.id, inc.resourceId) }))!;
  const involved = inc.subjectUserId === user.id || inc.reporterId === user.id;
  const staff = canManageResource(user, r);
  if (!involved && !staff) notFound();
  const canResolve = user.role === "admin" || (user.role === "manager" && r.department === user.department);
  const isBorrower = inc.subjectUserId === user.id;
  const myRole = statementRole(user, inc, r);
  const now = currentTime();

  const b = inc.bookingId ? await db.query.bookings.findFirst({ where: eq(schema.bookings.id, inc.bookingId) }) : null;
  const people = await db.select({ id: schema.users.id, name: schema.users.name, strikes: schema.users.strikes, suspended: schema.users.suspended }).from(schema.users);
  const name = (uid: string | null) => (uid === "system" ? "LoomLend rules" : (people.find((p) => p.id === uid)?.name ?? "—"));
  const subject = people.find((p) => p.id === inc.subjectUserId);
  const ai = parseJson<AdvisoryNote | null>(inc.aiSummary, null);
  const history = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, inc.id)).orderBy(asc(schema.auditLog.seq));
  const statements = await db.select().from(schema.incidentStatements).where(eq(schema.incidentStatements.incidentId, inc.id)).orderBy(asc(schema.incidentStatements.createdAt));
  const borrowerSpoke = statements.some((s) => s.role === "borrower");
  const notifiedAt = inc.status === "open" ? await borrowerNotifiedAt(inc) : null;
  const appeal = await appealState(inc.id);
  const reporterRole = inc.reporterId === "system" ? "system" : inc.reporterId === inc.subjectUserId ? "borrower" : inc.reporterId === r.ownerId ? "owner" : "witness";

  const thread = [
    { id: "report", userId: inc.reporterId, role: reporterRole as keyof typeof ROLE_STYLE, body: inc.description, photo: null as string | null, createdAt: inc.createdAt, isReport: true },
    ...statements.map((s) => ({ ...s, role: s.role as keyof typeof ROLE_STYLE, isReport: false })),
  ];

  return (
    <div className="space-y-6">
      <PageHeader kicker={`Incident · ${r.name}`} title={`${inc.type[0].toUpperCase()}${inc.type.slice(1)} report`}>
        <Badge status={inc.status} />
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Section title="What was reported">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="label">Reported by</dt><dd>{name(inc.reporterId)} · {fmtDateTime(inc.createdAt)}</dd></div>
              <div><dt className="label">Severity</dt><dd className="capitalize">{inc.severity}</dd></div>
              {subject && <div><dt className="label">Borrower</dt><dd>{subject.name}{staff ? ` · ${subject.strikes}/${STRIKE_LIMIT} strikes` : ""}</dd></div>}
              {b && <div><dt className="label">Booking</dt><dd><Link className="text-thread underline" href={`/bookings/${b.id}`}>{bookingRef(b.id)}</Link></dd></div>}
            </dl>
            {b && (
              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-md border border-line bg-white p-2">
                  <p className="label">At check-in</p>
                  <Condition value={b.checkOutCondition} />
                  <p className="text-muted">{b.checkOutNotes}</p>
                  {b.checkOutAt && <p className="mt-1"><ProofBadge method={b.checkOutMethod} /></p>}
                </div>
                <div className="rounded-md border border-line bg-white p-2">
                  <p className="label">At return</p>
                  <Condition value={b.returnCondition} />
                  <p className="text-muted">{b.returnNotes}</p>
                  {b.returnAt && <p className="mt-1"><ProofBadge method={b.returnMethod} /></p>}
                  {b.returnAt && b.returnAt > b.end && <p className="text-xs text-saffron">{Math.round((b.returnAt - b.end) / 60000)} min late</p>}
                </div>
              </div>
            )}
          </Section>

          {b?.checkOutPhoto && b.returnPhoto && (
            <Section title="Before and after photos">
              <ConditionCompare
                before={b.checkOutPhoto}
                after={b.returnPhoto}
                diff={parseDiff(b.aiConditionDiff)}
                bookingId={b.id}
                canRetry={staff || isBorrower}
                aiConfigured={visionEnabled()}
                staleMs={STALE_PENDING_MS}
                now={now}
              />
            </Section>
          )}

          {staff && <Advisory note={ai} title="Incident summary" />}

          <Section title="Each side" aside={<span className="text-xs text-muted">Visible to everyone involved</span>}>
            <ol className="space-y-3" aria-label="Statements, oldest first">
              {thread.map((s) => {
                const st = ROLE_STYLE[s.role] ?? ROLE_STYLE.witness;
                const who = s.userId === "system" ? "LoomLend rules" : name(s.userId);
                return (
                  <li key={s.id} className={`rounded-xl border border-line bg-white p-3 text-sm ${st.side}`}>
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="grid size-7 place-items-center rounded-full bg-ink text-[11px] font-bold text-white" aria-hidden>
                        {s.userId === "system" ? "LL" : initials(who)}
                      </span>
                      <span className="font-medium">{who}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.chip}`}>{s.isReport ? `${st.label} · original report` : st.label}</span>
                      <span className="text-xs text-muted">{fmtDateTime(s.createdAt)}</span>
                    </div>
                    <p className="whitespace-pre-line">{s.body}</p>
                    {s.photo && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.photo} alt={`Photo attached by ${who}`} className="mt-2 max-h-56 rounded-md border border-line" />
                    )}
                  </li>
                );
              })}
            </ol>
            {inc.subjectUserId && !borrowerSpoke && (
              <p className="mt-3 text-sm text-muted">{isBorrower ? "You have not added your side yet." : `${subject?.name ?? "The borrower"} has not added their side yet.`}</p>
            )}
            {inc.status === "open" && myRole && (
              <div className="mt-4 border-t border-line pt-4">
                <ActionForm action={addStatementAction}>
                  <input type="hidden" name="incidentId" value={inc.id} />
                  <div>
                    <label className="label" htmlFor="body">{isBorrower ? "Your side of what happened" : `Add a statement as ${ROLE_STYLE[myRole].label.toLowerCase()}`}</label>
                    <textarea
                      id="body"
                      name="body"
                      required
                      minLength={10}
                      maxLength={2000}
                      rows={4}
                      className="input"
                      placeholder={isBorrower ? "What happened, when, what you did about it. Facts help the manager most." : "What you observed, what it would cost to fix, anything the manager should check."}
                    />
                  </div>
                  <HandoverPhotoInput label="Photo" />
                  <Submit className="btn-primary min-h-11">Add statement</Submit>
                  <p className="text-xs text-muted">Everyone involved is notified. Statements cannot be edited later.</p>
                </ActionForm>
              </div>
            )}
          </Section>

          <Section title="History"><Timeline entries={history} /></Section>
        </div>

        <div className="space-y-6">
          {isBorrower && inc.status === "open" && (
            <Section title="What happens next">
              <ul className="list-disc space-y-1 pl-5 text-sm">
                <li>A manager from {r.department} reads both sides and decides. AI notes are advisory and cannot penalise you.</li>
                <li>Possible outcomes: dismissed (no penalty); upheld with no strike; upheld with a strike (you have {subject?.strikes ?? 0}/{STRIKE_LIMIT}).</li>
                <li>{STRIKE_LIMIT} strikes suspend booking privileges until an administrator reviews your account.</li>
                {r.depositRequired > 0 && <li>Repair costs may be recorded against the ₹{r.depositRequired} deposit (recorded, not charged by LoomLend).</li>}
                <li>If you disagree with the decision, you can appeal to an administrator from this page.</li>
              </ul>
            </Section>
          )}

          {inc.status !== "open" ? (
            <Section title="Outcome">
              <p className="text-sm">{inc.resolution}</p>
              <p className="mt-2 text-xs text-muted">
                {name(inc.resolvedBy)} · {fmtDateTime(inc.resolvedAt)} {inc.strikeIssued && "· a strike was issued"}
              </p>
              {appeal === "pending" && <Notice>An appeal is waiting for an administrator.</Notice>}
              {appeal === "upheld" && <p className="mt-2 text-sm">Appeal reviewed: the decision was upheld.</p>}
              {appeal === "overturned" && <p className="mt-2 text-sm text-teal">Appeal accepted by an administrator. Any strike from this incident was removed.</p>}

              {isBorrower && inc.status === "resolved" && !appeal && (
                <div className="mt-4 border-t border-line pt-4">
                  <ActionForm action={appealAction}>
                    <input type="hidden" name="incidentId" value={inc.id} />
                    <label className="label" htmlFor="reason">Appeal to an administrator</label>
                    <textarea id="reason" name="reason" required minLength={20} rows={3} className="input" placeholder="Why should the decision be reviewed? New facts help most." />
                    <Submit className="btn-ghost min-h-11">Send appeal</Submit>
                    <p className="text-xs text-muted">An administrator outside the department reviews it. You can appeal once.</p>
                  </ActionForm>
                </div>
              )}
              {user.role === "admin" && appeal === "pending" && (
                <div className="mt-4 border-t border-line pt-4">
                  <ActionForm action={decideAppealAction}>
                    <input type="hidden" name="incidentId" value={inc.id} />
                    <label className="label" htmlFor="note">Appeal decision (shown to the borrower)</label>
                    <textarea id="note" name="note" required minLength={10} rows={3} className="input" />
                    <div className="flex flex-wrap gap-2">
                      <Submit className="btn-ok min-h-11" name="verdict" value="overturned">{inc.strikeIssued ? "Accept: remove the strike" : "Accept appeal"}</Submit>
                      <Submit className="btn-ghost min-h-11" name="verdict" value="upheld">Uphold decision</Submit>
                    </div>
                  </ActionForm>
                </div>
              )}
            </Section>
          ) : canResolve ? (
            <Section title="Resolve (human decision)">
              {inc.subjectUserId && !borrowerSpoke && (
                <Notice tone="warn">
                  {subject?.name ?? "The borrower"} has not responded yet{notifiedAt ? ` (notified ${relative(notifiedAt, now)})` : ""}. Consider waiting for their side before deciding.
                </Notice>
              )}
              <div className="mt-3">
                <ActionForm action={resolveIncidentWithSidesAction}>
                  <input type="hidden" name="incidentId" value={inc.id} />
                  <div>
                    <label className="label" htmlFor="resolution">Resolution (shown to everyone involved)</label>
                    <textarea id="resolution" name="resolution" required minLength={10} rows={3} className="input" placeholder="e.g. Lens hood replaced (₹450) from the deposit. Borrower acknowledged." />
                  </div>
                  <fieldset className="flex gap-4 text-sm">
                    <legend className="sr-only">Outcome</legend>
                    <label className="flex min-h-11 items-center gap-2"><input type="radio" name="outcome" value="resolve" defaultChecked className="size-4 accent-thread" /> Upheld</label>
                    <label className="flex min-h-11 items-center gap-2"><input type="radio" name="outcome" value="dismiss" className="size-4 accent-thread" /> Dismiss</label>
                  </fieldset>
                  {inc.subjectUserId && (
                    <>
                      <label className="flex items-start gap-2 text-sm">
                        <input type="checkbox" name="issueStrike" className="mt-1 size-4 accent-rose" />
                        <span>Issue a strike to the borrower ({subject?.strikes ?? 0}/{STRIKE_LIMIT} now). {STRIKE_LIMIT} strikes suspend booking privileges until an admin reviews the account.</span>
                      </label>
                      <label className="flex items-start gap-2 text-sm">
                        <input type="checkbox" name="readBothSides" className="mt-1 size-4 accent-thread" />
                        <span>I have read both sides{borrowerSpoke ? "" : " (the borrower has not responded)"}. <span className="text-muted">Required to issue a strike.</span></span>
                      </label>
                    </>
                  )}
                  <Submit className="btn-primary min-h-11">Record decision</Submit>
                </ActionForm>
              </div>
            </Section>
          ) : (
            <Notice>A department manager or administrator reviews this report. You will be notified of the outcome{involved ? " and can see it here" : ""}.</Notice>
          )}
        </div>
      </div>
    </div>
  );
}
