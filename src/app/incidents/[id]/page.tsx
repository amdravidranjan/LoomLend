import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { canManageResource, requireUser } from "@/lib/auth";
import { STRIKE_LIMIT } from "@/lib/catalog";
import { fmtDateTime } from "@/lib/time";
import { bookingRef } from "@/lib/workflow";
import type { AdvisoryNote } from "@/lib/ai";
import { resolveIncidentAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { Advisory, Badge, Condition, Notice, PageHeader, Section, parseJson } from "@/components/ui";
import { Timeline } from "@/components/timeline";

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

  const b = inc.bookingId ? await db.query.bookings.findFirst({ where: eq(schema.bookings.id, inc.bookingId) }) : null;
  const people = await db.select({ id: schema.users.id, name: schema.users.name, strikes: schema.users.strikes }).from(schema.users);
  const name = (uid: string | null) => (uid === "system" ? "LoomLend rules" : (people.find((p) => p.id === uid)?.name ?? "—"));
  const subject = people.find((p) => p.id === inc.subjectUserId);
  const ai = parseJson<AdvisoryNote | null>(inc.aiSummary, null);
  const history = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, inc.id)).orderBy(asc(schema.auditLog.seq));

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
              <div className="sm:col-span-2"><dt className="label">Description</dt><dd>{inc.description}</dd></div>
            </dl>
            {b && (
              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-md border border-line bg-white p-2"><p className="label">At check-in</p><Condition value={b.checkOutCondition} /><p className="text-muted">{b.checkOutNotes}</p></div>
                <div className="rounded-md border border-line bg-white p-2"><p className="label">At return</p><Condition value={b.returnCondition} /><p className="text-muted">{b.returnNotes}</p></div>
              </div>
            )}
          </Section>
          {staff && <Advisory note={ai} title="Incident summary" />}
          <Section title="History"><Timeline entries={history} /></Section>
        </div>
        <div className="space-y-6">
          {inc.status !== "open" ? (
            <Section title="Outcome">
              <p className="text-sm">{inc.resolution}</p>
              <p className="mt-2 text-xs text-muted">
                {name(inc.resolvedBy)} · {fmtDateTime(inc.resolvedAt)} {inc.strikeIssued && "· a strike was issued"}
              </p>
            </Section>
          ) : canResolve ? (
            <Section title="Resolve (human decision)">
              <ActionForm action={resolveIncidentAction}>
                <input type="hidden" name="incidentId" value={inc.id} />
                <div>
                  <label className="label" htmlFor="resolution">Resolution (shown to everyone involved)</label>
                  <textarea id="resolution" name="resolution" required minLength={10} rows={3} className="input" placeholder="e.g. Lens hood replaced (₹450) from the deposit. Borrower acknowledged." />
                </div>
                <fieldset className="flex gap-4 text-sm">
                  <label className="flex items-center gap-2"><input type="radio" name="outcome" value="resolve" defaultChecked className="accent-thread" /> Upheld</label>
                  <label className="flex items-center gap-2"><input type="radio" name="outcome" value="dismiss" className="accent-thread" /> Dismiss</label>
                </fieldset>
                {inc.subjectUserId && (
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="issueStrike" className="mt-1 accent-rose" />
                    <span>Issue a strike to the borrower. {STRIKE_LIMIT} strikes suspend booking privileges until an admin reviews the account.</span>
                  </label>
                )}
                <Submit>Record decision</Submit>
              </ActionForm>
            </Section>
          ) : (
            <Notice>A department manager or administrator reviews this report. You will be notified of the outcome{involved ? " and can see it here" : ""}.</Notice>
          )}
        </div>
      </div>
    </div>
  );
}
