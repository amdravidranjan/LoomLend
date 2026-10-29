import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Booking, Resource } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { HOUR, currentTime, fmtRange } from "@/lib/time";
import { bookingRef, isOverdue, sweep } from "@/lib/workflow";
import { Badge, PageHeader } from "@/components/ui";
import { Icon, type IconName } from "@/components/ds/icons";
import { EmptyState, Tooltip } from "@/components/ds/primitives";
import { CopyButton, RelativeTime } from "@/components/ds/client";

export const metadata: Metadata = { title: "My bookings · LoomLend" };

type Row = { b: Booking; r: Resource };

function BookingRow({ b, r, now, cta }: Row & { now: number; cta?: { href: string; label: string; icon: IconName; tone?: string } }) {
  const overdue = isOverdue(b, now);
  const future = b.start > now;
  const showCountdown = ["approved", "pending", "waitlisted"].includes(b.status) && b.end > now;
  return (
    <li className="group relative flex flex-wrap items-center gap-x-4 gap-y-3 p-4 transition-colors hover:bg-sunken/60 sm:flex-nowrap">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-sunken text-2xl" aria-hidden>{r.emoji}</span>
      <div className="min-w-0 flex-1">
        <Link href={`/bookings/${b.id}`} className="font-medium after:absolute after:inset-0 after:content-[''] group-hover:text-thread focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:outline-2 focus-visible:after:outline-thread">
          {r.name}
        </Link>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted tabular">
          <span>{fmtRange(b.start, b.end)}</span>
          {showCountdown && (
            <span className="inline-flex items-center gap-1 rounded-full bg-thread-soft px-2 py-px text-xs font-medium text-thread">
              <Icon name="hourglass" size={12} />
              <RelativeTime ms={b.start} now={now} style="countdown" prefix={future ? "Starts " : "Started "} />
            </span>
          )}
          {b.status === "checked_out" && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-px text-xs font-medium ${overdue ? "bg-rose-soft text-rose" : "bg-saffron-soft text-saffron"}`}>
              <Icon name="clock" size={12} />
              <RelativeTime ms={b.end} now={now} style="countdown" prefix={overdue ? "Was due " : "Due "} />
            </span>
          )}
        </p>
        {b.decisionReason && ["rejected", "waitlisted", "cancelled"].includes(b.status) && (
          <p className="mt-1 text-sm text-ink/70">
            <span className="font-medium">Why:</span> {b.decisionReason}
          </p>
        )}
      </div>
      <div className="relative z-[1] flex shrink-0 items-center gap-2">
        <CopyButton value={bookingRef(b.id)} showValue label="Copy booking reference" />
        {["approved", "pending", "waitlisted"].includes(b.status) && b.end > now && (
          <Tooltip label="Add to calendar (.ics)">
            <a href={`/api/bookings/${b.id}/ics`} download className="grid size-9 place-items-center rounded-lg text-muted hover:bg-card hover:text-ink" aria-label={`Add ${r.name} to your calendar`}>
              <Icon name="calendarPlus" size={17} />
            </a>
          </Tooltip>
        )}
        {cta && (
          <Link href={cta.href} className={`${cta.tone ?? "btn-primary"} btn-sm`}>
            <Icon name={cta.icon} size={14} />
            {cta.label}
          </Link>
        )}
        {overdue ? <Badge status="overdue" label="Overdue" /> : <Badge status={b.status} />}
      </div>
    </li>
  );
}

function Group({ id, title, icon, rows, now, hint, cta }: { id: string; title: string; icon: IconName; rows: Row[]; now: number; hint?: string; cta?: (r: Row) => Parameters<typeof BookingRow>[0]["cta"] }) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby={`${id}-h`} className="enter">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 id={`${id}-h`} className="flex items-center gap-2 font-semibold">
          <Icon name={icon} size={17} className="text-muted" />
          {title}
        </h2>
        <span className="rounded-full bg-sunken px-2 text-xs font-semibold text-muted tabular">{rows.length}</span>
        {hint && <span className="hidden text-sm text-muted sm:inline">· {hint}</span>}
      </div>
      <ul className="card stagger divide-y divide-line overflow-hidden">
        {rows.map((row) => (
          <BookingRow key={row.b.id} {...row} now={now} cta={cta?.(row)} />
        ))}
      </ul>
    </section>
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
  const asc = (a: Row, b: Row) => a.b.start - b.b.start;

  const inUse = rows.filter(({ b }) => b.status === "checked_out").sort(asc);
  const soon = rows.filter(({ b }) => b.status === "approved" && b.end > now && b.start - now < 24 * HOUR).sort(asc);
  const later = rows.filter(({ b }) => b.status === "approved" && b.start - now >= 24 * HOUR).sort(asc);
  const deciding = rows.filter(({ b }) => (b.status === "pending" || b.status === "waitlisted") && b.end > now).sort(asc);
  const returned = rows.filter(({ b }) => b.status === "returned");
  const lapsed = rows.filter(({ b }) => ["approved", "pending", "waitlisted"].includes(b.status) && b.end <= now);
  const history = rows.filter(({ b }) => ["closed", "rejected", "cancelled"].includes(b.status));
  const hoursDone = history.filter(({ b }) => b.status === "closed").reduce((h, { b }) => h + (b.end - b.start) / HOUR, 0);
  const active = inUse.length + soon.length + later.length + deciding.length + returned.length + lapsed.length;

  return (
    <div className="space-y-8">
      <PageHeader
        kicker="Your loans"
        title="My bookings"
        description={rows.length ? `${active} active · ${history.filter(({ b }) => b.status === "closed").length} completed (${hoursDone.toFixed(1)} h)` : undefined}
      >
        <Link href="/scan" className="btn-ghost">
          <Icon name="scan" size={16} />
          Scan a tag
        </Link>
        <Link href="/resources" className="btn-primary">
          <Icon name="plus" size={16} />
          New booking
        </Link>
      </PageHeader>

      {rows.length === 0 ? (
        <EmptyState
          illustration="spool"
          title="No bookings yet"
          description="When you request a lab, tool or room it appears here, with a countdown to your slot and its full history."
          action={<Link href="/resources" className="btn-primary">Discover resources</Link>}
          secondary={<Link href="/assistant" className="btn-ghost"><Icon name="sparkle" size={16} />Ask the concierge</Link>}
        />
      ) : (
        <>
          <Group id="inuse" title="In use: return when done" icon="undo" rows={inUse} now={now} hint="Record the condition when you hand it back" cta={({ b }) => ({ href: `/bookings/${b.id}`, label: "Return", icon: "undo", tone: isOverdue(b, now) ? "btn-danger" : "btn-primary" })} />
          <Group id="soon" title="Ready to check in" icon="scan" rows={soon} now={now} hint="Scan the tag at the door" cta={() => ({ href: "/scan", label: "Scan", icon: "scan" })} />
          <Group id="later" title="Upcoming" icon="calendar" rows={later} now={now} />
          <Group id="deciding" title="Awaiting a decision" icon="hourglass" rows={deciding} now={now} hint="A person reviews every request" />
          <Group id="returned" title="Returned, awaiting the owner's inspection" icon="box" rows={returned} now={now} />
          <Group id="lapsed" title="Slot has passed" icon="clock" rows={lapsed} now={now} />
          {active === 0 && (
            <EmptyState compact illustration="check" title="Nothing active right now" description="Your history is below." action={<Link href="/resources" className="btn-primary btn-sm">Book something</Link>} />
          )}
          {history.length > 0 && (
            <details className="group" open={active === 0}>
              <summary className="mb-2 flex cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden">
                <Icon name="thread" size={17} className="text-muted" />
                History
                <span className="rounded-full bg-sunken px-2 text-xs font-semibold text-muted tabular">{history.length}</span>
                <Icon name="chevronDown" size={16} className="text-muted transition-transform group-open:rotate-180" />
              </summary>
              <ul className="card divide-y divide-line overflow-hidden">
                {history.map((row) => (
                  <BookingRow key={row.b.id} {...row} now={now} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
