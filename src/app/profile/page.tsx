import type { Metadata } from "next";
import { desc, eq, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { AFFILIATIONS, CERTS, ROLE_LABEL, STRIKE_LIMIT } from "@/lib/catalog";
import { HOUR, currentTime } from "@/lib/time";
import { submitCertAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { Badge, Notice, Section } from "@/components/ui";
import { Timeline } from "@/components/timeline";
import { Icon } from "@/components/ds/icons";
import { Avatar, Meter, Stat } from "@/components/ds/primitives";
import { RelativeTime, ThemeToggle } from "@/components/ds/client";

export const metadata: Metadata = { title: "Profile · LoomLend" };

export default async function ProfilePage({ searchParams }: PageProps<"/profile">) {
  const user = await requireUser();
  const sp = await searchParams;
  const now = currentTime();
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

  const total = Object.keys(CERTS).length;
  const verified = certs.filter((c) => c.status === "verified").length;
  const pending = certs.filter((c) => c.status === "pending").length;
  const addable = Object.entries(CERTS).filter(([k]) => certs.find((c) => c.certKey === k)?.status !== "verified");
  const standing = user.suspended ? "Suspended" : user.strikes === 0 ? "Good standing" : `${user.strikes} strike${user.strikes === 1 ? "" : "s"} on record`;

  return (
    <div className="space-y-6">
      {sp.welcome && (
        <Notice tone="ok" title="Welcome to LoomLend">
          Add your training records below. The facilities office will verify your ID; once both are done, resources unlock automatically.
        </Notice>
      )}

      <div className="enter flex flex-wrap items-center gap-4">
        <Avatar name={user.name} size={64} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-[0.14em] text-saffron uppercase">{ROLE_LABEL[user.role]}</p>
          <h1 className="h-display text-3xl font-semibold tracking-tight sm:text-4xl">{user.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span>{user.department}</span>
            <span aria-hidden>·</span>
            <span>{AFFILIATIONS[user.affiliation]}</span>
            <span aria-hidden>·</span>
            {user.idVerified ? <Badge status="verified" label="ID verified" /> : <Badge status="pending" label="ID not verified" />}
          </p>
        </div>
      </div>

      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card p-4"><Stat value={done.length} label="Completed loans" hint={`${hours.toFixed(1)} hours in total`} /></div>
        <div className="card p-4"><Stat value={done.length ? `${Math.round((onTime / done.length) * 100)}%` : "—"} label="Returned on time" hint={done.length ? `${onTime} of ${done.length}` : "No loans yet"} tone={done.length && onTime === done.length ? "teal" : "ink"} /></div>
        <div className="card p-4"><Stat value={`${verified}/${total}`} label="Training verified" hint={pending ? `${pending} awaiting a manager` : undefined} tone="thread" /></div>
        <div className="card p-4">
          <p className="flex h-9 items-center gap-1.5" aria-label={`${user.strikes} of ${STRIKE_LIMIT} strikes`}>
            {Array.from({ length: STRIKE_LIMIT }, (_, i) => (
              <span key={i} className={`h-2.5 w-6 rounded-full ${i < user.strikes ? "bg-rose" : "bg-sunken ring-1 ring-line ring-inset"}`} />
            ))}
          </p>
          <p className="mt-1 text-sm text-muted">{standing}</p>
          <p className="mt-0.5 text-xs text-subtle">{STRIKE_LIMIT} strikes pause booking until an admin reviews</p>
        </div>
      </div>

      {user.suspended && <Notice tone="error" title="Booking privileges suspended">An administrator reviews suspended accounts. The incidents behind each strike are in your activity below.</Notice>}

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Section title="Training & qualifications" icon="shield" description="Verified training unlocks resources that require it." aside={<span className="text-sm font-medium tabular">{Math.round((verified / total) * 100)}%</span>}>
          <Meter value={verified} max={total} tone="teal" label="Training verified" className="mb-4" />
          <ul className="stagger mb-6 space-y-2">
            {Object.entries(CERTS).map(([key, c]) => {
              const rec = certs.find((x) => x.certKey === key);
              const icon = rec?.status === "verified" ? "check" : rec?.status === "pending" ? "hourglass" : rec?.status === "rejected" ? "x" : "plus";
              const tone = rec?.status === "verified" ? "bg-teal-soft text-teal" : rec?.status === "pending" ? "bg-amber-soft text-amber-ink" : rec?.status === "rejected" ? "bg-rose-soft text-rose" : "bg-sunken text-subtle";
              return (
                <li key={key} className="flex items-start gap-3 rounded-lg border border-line bg-field p-3 text-sm">
                  <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ${tone}`}>
                    <Icon name={icon} size={14} strokeWidth={2.4} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{c.label}</span>
                    <span className="block text-muted">{c.description}</span>
                    {rec?.status === "rejected" && <span className="mt-1 block text-rose">Not verified: {rec.reviewNote}</span>}
                    {rec?.status === "pending" && (
                      <span className="mt-1 block text-xs text-muted">
                        Submitted <RelativeTime ms={rec.createdAt} now={now} />
                      </span>
                    )}
                  </span>
                  {rec ? <Badge status={rec.status} label={rec.status[0].toUpperCase() + rec.status.slice(1)} /> : <span className="pt-1 text-xs text-subtle">Not added</span>}
                </li>
              );
            })}
          </ul>
          {addable.length > 0 && (
            <div className="rounded-xl border border-dashed border-line-strong/70 p-4">
              <h3 className="mb-3 font-semibold">Add a training record</h3>
              <ActionForm action={submitCertAction} resetOnSuccess className="space-y-3">
                <div>
                  <label className="label" htmlFor="certKey">Training</label>
                  <select id="certKey" name="certKey" className="input">
                    {addable.map(([k, c]) => (
                      <option key={k} value={k}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="evidence">Evidence</label>
                  <textarea id="evidence" name="evidence" required minLength={10} rows={2} className="input" placeholder="Session date, trainer name, certificate or attendance number." aria-describedby="evidence-hint" />
                  <p id="evidence-hint" className="mt-1 text-xs text-muted">At least 10 characters. A manager checks this against the training register; nothing unlocks until a person verifies it.</p>
                </div>
                <Submit pendingLabel="Submitting…">Submit for verification</Submit>
              </ActionForm>
            </div>
          )}
        </Section>

        <div className="space-y-6">
          <Section title="Your recent activity" icon="thread" description="Your entries in the Weave, the tamper-evident log.">
            <Timeline entries={activity} />
          </Section>
          <Section title="Preferences" icon="palette">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span>
                <span className="block font-medium">Theme</span>
                <span className="block text-muted">Follow your device, or pick one.</span>
              </span>
              <ThemeToggle />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
