import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Resource, User } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { currentTime, fmtRange, relative } from "@/lib/time";
import { bookingRef, isOverdue, sweep } from "@/lib/workflow";
import { overlaps } from "@/lib/rules";
import type { AdvisoryNote } from "@/lib/ai";
import { Badge, Empty, PageHeader, Pill, Section, parseJson } from "@/components/ui";
import { Icon } from "@/components/ds/icons";

export const metadata = { title: "Manage · LoomLend" };

function managedBy(user: User, r: Resource) {
  return user.role === "admin" || (user.role === "manager" ? r.department === user.department : r.ownerId === user.id);
}

export default async function ManagePage() {
  const user = await requireUser(["owner", "manager", "admin"]);
  await sweep();
  const resources = (await db.select().from(schema.resources)).filter((r) => managedBy(user, r));
  const ids = resources.map((r) => r.id).concat("none");
  const rows = await db
    .select({ b: schema.bookings, u: { id: schema.users.id, name: schema.users.name, department: schema.users.department, strikes: schema.users.strikes } })
    .from(schema.bookings)
    .innerJoin(schema.users, eq(schema.users.id, schema.bookings.userId))
    .where(inArray(schema.bookings.resourceId, ids))
    .orderBy(schema.bookings.start);
  const incidents = await db.select().from(schema.incidents).where(inArray(schema.incidents.resourceId, ids)).orderBy(desc(schema.incidents.createdAt));
  const res = (id: string) => resources.find((r) => r.id === id)!;
  const now = currentTime();

  const openRounds = await db.select().from(schema.allocationRounds).where(eq(schema.allocationRounds.status, "open"));
  const roundOf = (roundId: string | null) => (roundId ? openRounds.find((x) => x.id === roundId) : undefined);

  const pending = rows.filter(({ b }) => b.status === "pending");
  const waiting = rows.filter(({ b }) => b.status === "waitlisted" && b.end > now);
  const returns = rows.filter(({ b }) => b.status === "returned");
  const inUse = rows.filter(({ b }) => b.status === "checked_out").sort((a, c) => a.b.end - c.b.end);
  const upcoming = rows.filter(({ b }) => b.status === "approved" && b.end > now);

  return (
    <div className="space-y-6">
      <PageHeader kicker={user.role === "owner" ? "Your listings" : user.role === "manager" ? `${user.department} department` : "All departments"} title="Manage">
        <Link href="/resources/new" className="btn-primary"><Icon name="plus" size={16} />List a resource</Link>
      </PageHeader>

      <div id="requests">
        <Section title={`Requests to review (${pending.length})`} aside={<Link href="/policy" className="text-xs text-thread">How priority works</Link>}>
          {pending.length === 0 ? (
            <Empty>No requests waiting. Nice.</Empty>
          ) : (
            <ul className="space-y-3">
              {pending.map(({ b, u }) => {
                const r = res(b.resourceId);
                const rivals = pending.filter((p) => p.b.id !== b.id && p.b.resourceId === b.resourceId && overlaps(p.b, b));
                const ai = parseJson<AdvisoryNote | null>(b.aiReview, null);
                const round = roundOf(b.roundId);
                if (round) {
                  return (
                    <li key={b.id} className="rounded-lg border border-dashed border-line bg-card p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">{r.emoji} {r.name}</p>
                          <p className="text-sm text-muted">{fmtRange(b.start, b.end)} · {u.name} ({u.department})</p>
                        </div>
                        <Pill tone="info">In the draw · closes {relative(round.closesAt, now)}</Pill>
                      </div>
                      <p className="mt-2 text-sm text-muted">This request is decided by the fair draw, not individually. You confirm the winners after it runs.</p>
                      <Link href={`/resources/${r.id}#draw`} className="btn-ghost mt-3">Go to the draw →</Link>
                    </li>
                  );
                }
                return (
                  <li key={b.id} className="rounded-lg border border-line bg-card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{r.emoji} {r.name}</p>
                        <p className="text-sm text-muted">{fmtRange(b.start, b.end)} · {u.name} ({u.department}){u.strikes ? ` · ${u.strikes} strike(s)` : ""}</p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Pill tone="info">Priority {b.priorityScore}</Pill>
                        {ai && <Pill tone={ai.risk === "low" ? "ok" : "warn"}>Risk {ai.risk}</Pill>}
                        {r.supervisionRequired && <Pill tone="warn">Supervised</Pill>}
                      </div>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-ink/80">“{b.purpose}”</p>
                    {rivals.length > 0 && (
                      <p className="mt-2 text-sm text-saffron">
                        ⚖ Competes with {rivals.map((x) => `${bookingRef(x.b.id)} (${x.u.name}, priority ${x.b.priorityScore})`).join(", ")}.{" "}
                        {rivals.every((x) => x.b.priorityScore < b.priorityScore) ? "This one ranks higher." : rivals.some((x) => x.b.priorityScore > b.priorityScore) ? "Another request ranks higher." : "Tied: earlier request first."}
                      </p>
                    )}
                    <Link href={`/bookings/${b.id}`} className="btn-ghost mt-3">Review →</Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div id="returns">
          <Section title={`Returns to inspect (${returns.length})`}>
            {returns.length === 0 ? <Empty>No returns waiting.</Empty> : (
              <ul className="divide-y divide-line">
                {returns.map(({ b, u }) => (
                  <li key={b.id}>
                    <Link href={`/bookings/${b.id}`} className="flex items-center justify-between gap-2 py-2 hover:bg-paper">
                      <span className="text-sm"><span className="font-medium">{res(b.resourceId).name}</span><span className="block text-muted">{u.name} · returned {relative(b.returnAt!)}</span></span>
                      <Badge status="returned" label="Confirm" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
        <div id="active">
          <Section title={`In use now (${inUse.length})`}>
            {inUse.length === 0 ? <Empty>Nothing checked out.</Empty> : (
              <ul className="divide-y divide-line">
                {inUse.map(({ b, u }) => (
                  <li key={b.id}>
                    <Link href={`/bookings/${b.id}`} className="flex items-center justify-between gap-2 py-2 hover:bg-paper">
                      <span className="text-sm"><span className="font-medium">{res(b.resourceId).name}</span><span className="block text-muted">{u.name} · due {relative(b.end)}</span></span>
                      {isOverdue(b, now) ? <Badge status="overdue" label="Overdue" /> : <Badge status="checked_out" />}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={`Upcoming approved (${upcoming.length})`}>
          {upcoming.length === 0 ? <Empty>None.</Empty> : (
            <ul className="divide-y divide-line text-sm">
              {upcoming.map(({ b, u }) => (
                <li key={b.id}>
                  <Link href={`/bookings/${b.id}`} className="flex justify-between gap-2 py-2 hover:bg-paper">
                    <span><span className="font-medium">{res(b.resourceId).name}</span><span className="block text-muted">{u.name} · {fmtRange(b.start, b.end)}</span></span>
                    {res(b.resourceId).supervisionRequired && <Pill tone="warn">You supervise</Pill>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title={`Waiting lists (${waiting.length})`}>
          {waiting.length === 0 ? <Empty>Nobody waiting.</Empty> : (
            <ul className="divide-y divide-line text-sm">
              {waiting.map(({ b, u }) => (
                <li key={b.id}>
                  <Link href={`/bookings/${b.id}`} className="flex justify-between gap-2 py-2 hover:bg-paper">
                    <span><span className="font-medium">{res(b.resourceId).name}</span><span className="block text-muted">{u.name} · {fmtRange(b.start, b.end)}</span></span>
                    <Pill tone="info">Priority {b.priorityScore}</Pill>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div id="incidents">
        <Section title="Incidents">
          {incidents.length === 0 ? <Empty>No incidents reported.</Empty> : (
            <ul className="divide-y divide-line text-sm">
              {incidents.map((i) => (
                <li key={i.id}>
                  <Link href={`/incidents/${i.id}`} className="flex items-center justify-between gap-2 py-2 hover:bg-paper">
                    <span><span className="font-medium capitalize">{i.type}: {res(i.resourceId).name}</span><span className="block text-muted">{i.severity} severity · {relative(i.createdAt)}</span></span>
                    <Badge status={i.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title={`Listings (${resources.length})`}>
        <ul className="grid gap-2 sm:grid-cols-2">
          {resources.map((r) => (
            <li key={r.id}>
              <Link href={`/resources/${r.id}`} className="flex items-center justify-between gap-2 rounded-md border border-line bg-card p-2 text-sm hover:border-thread">
                <span>{r.emoji} {r.name}</span>
                <Badge status={r.status} />
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
