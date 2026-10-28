import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { sweep, isOverdue, demoMode } from "@/lib/workflow";
import { fmtRange, relative } from "@/lib/time";
import { Badge, Empty, Notice, PageHeader, Section } from "@/components/ui";
import { DemoAccounts } from "@/components/demo-accounts";
import { Logo } from "@/components/logo";

export default async function Home({ searchParams }: PageProps<"/">) {
  const user = await getCurrentUser();
  const sp = await searchParams;
  if (!user) return <Landing />;
  await sweep();

  const mine = await db
    .select({ b: schema.bookings, r: schema.resources })
    .from(schema.bookings)
    .innerJoin(schema.resources, eq(schema.resources.id, schema.bookings.resourceId))
    .where(and(eq(schema.bookings.userId, user.id), inArray(schema.bookings.status, ["pending", "approved", "waitlisted", "checked_out", "returned"])))
    .orderBy(schema.bookings.start);

  const notes = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, user.id)).orderBy(desc(schema.notifications.createdAt)).limit(5);

  let staffCounts: { pending: number; returns: number; active: number; incidents: number } | null = null;
  if (isStaff(user)) {
    const all = await db.select({ b: schema.bookings, r: schema.resources }).from(schema.bookings).innerJoin(schema.resources, eq(schema.resources.id, schema.bookings.resourceId));
    const managed = all.filter(({ r }) => user.role === "admin" || (user.role === "manager" ? r.department === user.department : r.ownerId === user.id));
    const incs = await db.select({ i: schema.incidents, r: schema.resources }).from(schema.incidents).innerJoin(schema.resources, eq(schema.resources.id, schema.incidents.resourceId)).where(eq(schema.incidents.status, "open"));
    staffCounts = {
      pending: managed.filter(({ b }) => b.status === "pending").length,
      returns: managed.filter(({ b }) => b.status === "returned").length,
      active: managed.filter(({ b }) => b.status === "checked_out").length,
      incidents: incs.filter(({ r }) => user.role === "admin" || (user.role === "manager" ? r.department === user.department : r.ownerId === user.id)).length,
    };
  }

  return (
    <div className="space-y-6">
      {sp.denied && <Notice tone="warn">That page needs a different role.</Notice>}
      <PageHeader kicker={user.department} title={`Hello, ${user.name.split(" ")[0]}`}>
        <Link href="/resources" className="btn-primary">
          Find a resource
        </Link>
      </PageHeader>

      {user.suspended && <Notice tone="error">Your booking privileges are suspended. See your profile for details.</Notice>}
      {!user.idVerified && <Notice tone="warn">Your identity is not verified yet, so most resources are locked. The facilities office verifies new accounts.</Notice>}

      {staffCounts && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { n: staffCounts.pending, label: "Requests to review", href: "/manage#requests" },
            { n: staffCounts.returns, label: "Returns to confirm", href: "/manage#returns" },
            { n: staffCounts.active, label: "Items in use", href: "/manage#active" },
            { n: staffCounts.incidents, label: "Open incidents", href: "/manage#incidents" },
          ].map((s) => (
            <Link key={s.label} href={s.href} className="card p-4 hover:border-thread">
              <p className="h-display text-3xl font-semibold">{s.n}</p>
              <p className="text-sm text-muted">{s.label}</p>
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Section title="Your active bookings" aside={<Link href="/bookings" className="text-sm text-thread">All bookings →</Link>}>
          {mine.length === 0 ? (
            <Empty>
              Nothing booked. <Link className="text-thread underline" href="/resources">Discover what you can use</Link>.
            </Empty>
          ) : (
            <ul className="divide-y divide-line">
              {mine.map(({ b, r }) => (
                <li key={b.id}>
                  <Link href={`/bookings/${b.id}`} className="flex items-center gap-3 py-3 hover:bg-paper">
                    <span className="text-2xl" aria-hidden>{r.emoji}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{r.name}</span>
                      <span className="block text-sm text-muted">
                        {fmtRange(b.start, b.end)} · {relative(b.start)}
                      </span>
                    </span>
                    {isOverdue(b) ? <Badge status="overdue" label="Overdue" /> : <Badge status={b.status} />}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Latest updates" aside={<Link href="/notifications" className="text-sm text-thread">All →</Link>}>
          {notes.length === 0 ? (
            <Empty>No notifications yet.</Empty>
          ) : (
            <ul className="space-y-3">
              {notes.map((n) => (
                <li key={n.id} className="text-sm">
                  <Link href={n.link ?? "/notifications"} className="block hover:text-thread">
                    <span className={`font-medium ${n.read ? "" : "text-ink"}`}>{!n.read && <span className="mr-1 inline-block size-2 rounded-full bg-saffron" aria-label="unread" />}{n.title}</span>
                    <span className="block text-muted">{n.body}</span>
                    <span className="text-xs text-muted">{relative(n.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      {demoMode() && (
        <p className="text-xs text-muted">
          Demo mode: check-in is allowed at any time during a booking day so judges can complete the full journey without waiting. Switch accounts from the{" "}
          <Link href="/login" className="underline">sign-in page</Link>.
        </p>
      )}
    </div>
  );
}

function Landing() {
  const steps = [
    ["List", "Owners publish labs, tools and rooms with hours, training needs, supervision and deposits."],
    ["Check", "Members see exactly which requirements they meet before they ask."],
    ["Request", "Fair-share caps and a visible priority score decide competing slots."],
    ["Review", "A person approves, rejects or waitlists, always with a reason."],
    ["Hand over", "Check-in and return record condition, with photos."],
    ["Account", "Damage, delays and disputes go to a manager; every step lands in a tamper-evident log."],
  ];
  return (
    <div className="space-y-12">
      <section className="weave -mx-4 rounded-none px-4 py-12 sm:mx-0 sm:rounded-2xl sm:px-10">
        <div className="max-w-2xl">
          <Logo size={44} />
          <h1 className="h-display mt-4 text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">
            Idle labs, woven into <span className="text-thread">shared opportunity</span>.
          </h1>
          <p className="mt-4 text-lg text-ink/80">
            LoomLend lets a college share its laser cutters, oscilloscopes, studios and seminar halls with the students and researchers who need them,
            while owners stay in control: training checks, supervised hand-overs, fair allocation and a full audit trail.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/login" className="btn-primary">
              Try a demo account
            </Link>
            <Link href="/resources" className="btn-ghost">
              Browse resources
            </Link>
          </div>
        </div>
      </section>

      <section>
        <h2 className="h-display mb-4 text-2xl font-semibold">Every borrow, a thread on the loom</h2>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map(([t, d], i) => (
            <li key={t} className="card p-4">
              <p className="text-xs font-bold tracking-widest text-saffron">STEP {i + 1}</p>
              <p className="mt-1 font-semibold">{t}</p>
              <p className="text-sm text-muted">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="h-display mb-1 text-2xl font-semibold">Jump in as anyone</h2>
        <p className="mb-4 text-sm text-muted">One click signs you in. All people and data are fictional.</p>
        <DemoAccounts />
      </section>
    </div>
  );
}
