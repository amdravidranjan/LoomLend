import { desc, eq, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { AFFILIATIONS, CERTS, ROLE_LABEL, STRIKE_LIMIT } from "@/lib/catalog";
import { HOUR, relative } from "@/lib/time";
import { submitCertAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { Badge, Notice, PageHeader, Section } from "@/components/ui";
import { Timeline } from "@/components/timeline";

export default async function ProfilePage({ searchParams }: PageProps<"/profile">) {
  const user = await requireUser();
  const sp = await searchParams;
  const certs = await db.select().from(schema.certifications).where(eq(schema.certifications.userId, user.id));
  const bookings = await db.select().from(schema.bookings).where(eq(schema.bookings.userId, user.id));
  const done = bookings.filter((b) => b.status === "closed" && !b.decisionReason?.startsWith("No-show"));
  const hours = done.reduce((h, b) => h + (b.end - b.start) / HOUR, 0);
  const onTime = done.filter((b) => b.returnAt && b.returnAt <= b.end).length;
  const activity = await db
    .select()
    .from(schema.auditLog)
    .where(or(eq(schema.auditLog.entityId, user.id), eq(schema.auditLog.actorId, user.id)))
    .orderBy(desc(schema.auditLog.seq))
    .limit(10);

  return (
    <div className="space-y-6">
      {sp.welcome && <Notice tone="ok">Welcome! Add your training records below. The facilities office will verify your ID.</Notice>}
      <PageHeader kicker={ROLE_LABEL[user.role]} title={user.name} />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-6">
          <Section title="Standing">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="label">Department</dt><dd>{user.department}</dd></div>
              <div><dt className="label">Membership</dt><dd>{AFFILIATIONS[user.affiliation]}</dd></div>
              <div><dt className="label">Identity</dt><dd>{user.idVerified ? <Badge status="verified" label="Verified" /> : <Badge status="pending" label="Not verified" />}</dd></div>
              <div><dt className="label">Strikes</dt><dd>{user.suspended ? <Badge status="rejected" label="Suspended" /> : `${user.strikes} of ${STRIKE_LIMIT}`}</dd></div>
              <div><dt className="label">Completed loans</dt><dd>{done.length} ({hours.toFixed(1)} h)</dd></div>
              <div><dt className="label">Returned on time</dt><dd>{done.length ? `${onTime} of ${done.length}` : "—"}</dd></div>
            </dl>
          </Section>
          <Section title="Your recent activity">
            <Timeline entries={activity} />
          </Section>
        </div>

        <Section title="Training & qualifications">
          <ul className="mb-5 space-y-2">
            {Object.entries(CERTS).map(([key, c]) => {
              const rec = certs.find((x) => x.certKey === key);
              return (
                <li key={key} className="flex items-start justify-between gap-3 rounded-md border border-line bg-white p-3 text-sm">
                  <span>
                    <span className="font-medium">{c.label}</span>
                    <span className="block text-muted">{c.description}</span>
                    {rec?.status === "rejected" && <span className="block text-rose">Rejected: {rec.reviewNote}</span>}
                    {rec?.status === "pending" && <span className="block text-muted">Submitted {relative(rec.createdAt)}</span>}
                  </span>
                  {rec ? <Badge status={rec.status} label={rec.status[0].toUpperCase() + rec.status.slice(1)} /> : <span className="text-xs text-muted">Not added</span>}
                </li>
              );
            })}
          </ul>
          <h3 className="label">Add a training record</h3>
          <ActionForm action={submitCertAction}>
            <select name="certKey" className="input" aria-label="Training type">
              {Object.entries(CERTS)
                .filter(([k]) => certs.find((c) => c.certKey === k)?.status !== "verified")
                .map(([k, c]) => (
                  <option key={k} value={k}>{c.label}</option>
                ))}
            </select>
            <textarea name="evidence" required minLength={10} rows={2} className="input" placeholder="Session date, trainer name, certificate or attendance number." aria-label="Evidence" />
            <Submit>Submit for verification</Submit>
            <p className="text-xs text-muted">A manager checks this against the training register. Nothing unlocks until a person verifies it.</p>
          </ActionForm>
        </Section>
      </div>
    </div>
  );
}
