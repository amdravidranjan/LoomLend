import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Booking, Resource } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { currentTime, fmtRange } from "@/lib/time";
import { bookingRef, isOverdue, sweep } from "@/lib/workflow";
import { Badge, Empty, PageHeader } from "@/components/ui";

function BookingList({ items, now }: { items: { b: Booking; r: Resource }[]; now: number }) {
  if (items.length === 0) return <Empty>Nothing here.</Empty>;
  return (
    <ul className="card divide-y divide-line">
      {items.map(({ b, r }) => (
        <li key={b.id}>
          <Link href={`/bookings/${b.id}`} className="flex flex-wrap items-center gap-3 p-4 hover:bg-paper">
            <span className="text-2xl" aria-hidden>{r.emoji}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{r.name}</span>
              <span className="block text-sm text-muted">
                {bookingRef(b.id)} · {fmtRange(b.start, b.end)}
              </span>
              {b.decisionReason && ["rejected", "waitlisted", "cancelled"].includes(b.status) && (
                <span className="block text-sm text-ink/70">Why: {b.decisionReason}</span>
              )}
            </span>
            {isOverdue(b, now) ? <Badge status="overdue" label="Overdue" /> : <Badge status={b.status} />}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function MyBookings() {
  const user = await requireUser();
  await sweep();
  const rows = await db
    .select({ b: schema.bookings, r: schema.resources })
    .from(schema.bookings)
    .innerJoin(schema.resources, eq(schema.resources.id, schema.bookings.resourceId))
    .where(eq(schema.bookings.userId, user.id))
    .orderBy(desc(schema.bookings.start));
  const now = currentTime();
  const isActive = (s: string) => ["pending", "approved", "waitlisted", "checked_out", "returned"].includes(s);

  return (
    <div className="space-y-8">
      <PageHeader kicker="Your loans" title="My bookings">
        <Link href="/resources" className="btn-primary">New booking</Link>
      </PageHeader>
      <section>
        <h2 className="mb-3 font-semibold">Active & upcoming</h2>
        <BookingList items={rows.filter(({ b }) => isActive(b.status))} now={now} />
      </section>
      <section>
        <h2 className="mb-3 font-semibold">History</h2>
        <BookingList items={rows.filter(({ b }) => !isActive(b.status))} now={now} />
      </section>
    </div>
  );
}
