import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Booking, Resource } from "@/db/schema";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { sweep, isOverdue, demoMode, bookingRef } from "@/lib/workflow";
import { HOUR, campusParts, currentTime, fmtDay, fmtRange, fmtTime } from "@/lib/time";
import { CERTS, STATUS_LABEL } from "@/lib/catalog";
import { Badge, Notice, Section } from "@/components/ui";
import { DemoAccounts, FEATURED } from "@/components/demo-accounts";
import { Icon, type IconName } from "@/components/ds/icons";
import { EmptyState } from "@/components/ds/primitives";
import { CopyButton, RelativeTime } from "@/components/ds/client";
import { HeroWeave } from "@/components/ds/hero-weave";
import { publicStats } from "@/components/ds/server/stats";

function greeting(hour: number) {
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default async function Home({ searchParams }: PageProps<"/">) {
  const user = await getCurrentUser();
  const sp = await searchParams;
  if (!user) return <Landing />;
  await sweep();
  const now = currentTime();

  const mine = await db
    .select({ b: schema.bookings, r: schema.resources })
    .from(schema.bookings)
    .innerJoin(schema.resources, eq(schema.resources.id, schema.bookings.resourceId))
    .where(and(eq(schema.bookings.userId, user.id), inArray(schema.bookings.status, ["pending", "approved", "waitlisted", "checked_out", "returned"])))
    .orderBy(schema.bookings.start);

  const notes = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, user.id)).orderBy(desc(schema.notifications.createdAt)).limit(5);
  const certs = await db.select().from(schema.certifications).where(eq(schema.certifications.userId, user.id));

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

  // The one booking that matters most right now: something in use, else the next approved slot.
  const next =
    mine.find(({ b }) => b.status === "checked_out") ??
    mine.find(({ b }) => b.status === "approved" && b.end > now) ??
    mine.find(({ b }) => (b.status === "pending" || b.status === "waitlisted") && b.end > now);

  type Todo = { icon: IconName; tone: "danger" | "warn" | "info" | "ok"; title: string; detail: string; href: string; cta: string };
  const todos: Todo[] = [];
  for (const { b, r } of mine) {
    if (b.status === "checked_out")
      todos.push({
        icon: "undo",
        tone: isOverdue(b, now) ? "danger" : "warn",
        title: `${isOverdue(b, now) ? "Overdue: return" : "Return"} ${r.name.split(" · ")[0]}`,
        detail: `Due ${fmtTime(b.end)} · ${r.location}`,
        href: `/bookings/${b.id}`,
        cta: "Return",
      });
    else if (b.status === "approved" && b.end > now && b.start - now < 24 * HOUR)
      todos.push({ icon: "scan", tone: "info", title: `Check in to ${r.name.split(" · ")[0]}`, detail: `${fmtRange(b.start, b.end)} · scan the tag at the door`, href: "/scan", cta: "Scan" });
  }
  const waiting = mine.filter(({ b }) => b.status === "pending").length;
  if (waiting) todos.push({ icon: "hourglass", tone: "info", title: `${waiting} request${waiting === 1 ? "" : "s"} awaiting the owner`, detail: "You'll be notified the moment a person decides.", href: "/bookings", cta: "View" });
  for (const c of certs.filter((c) => c.status === "pending"))
    todos.push({ icon: "shield", tone: "info", title: `${CERTS[c.certKey]?.label ?? c.certKey} awaiting verification`, detail: "A manager checks it against the training register.", href: "/profile", cta: "Details" });
  for (const c of certs.filter((c) => c.status === "rejected"))
    todos.push({ icon: "alert", tone: "warn", title: `${CERTS[c.certKey]?.label ?? c.certKey} was not verified`, detail: c.reviewNote ?? "See the reviewer's note and resubmit.", href: "/profile", cta: "Resubmit" });
  if (staffCounts?.pending) todos.push({ icon: "layers", tone: "warn", title: `${staffCounts.pending} request${staffCounts.pending === 1 ? "" : "s"} to review`, detail: "Competing requests show their priority score.", href: "/manage#requests", cta: "Review" });
  if (staffCounts?.returns) todos.push({ icon: "box", tone: "warn", title: `${staffCounts.returns} return${staffCounts.returns === 1 ? "" : "s"} to inspect`, detail: "Confirm the condition to close the loan.", href: "/manage#returns", cta: "Inspect" });

  const hour = campusParts(now).hour;
  const first = user.name.replace(/^Dr\.\s+/, "").split(" ")[0];
  const upcoming = mine.filter(({ b }) => b.id !== next?.b.id);

  return (
    <div className="space-y-6">
      {sp.denied && <Notice tone="warn">That page needs a different role.</Notice>}

      <div className="enter flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-saffron uppercase">
            {fmtDay(now)} · {user.department}
          </p>
          <h1 className="h-display mt-0.5 text-3xl font-semibold tracking-tight sm:text-4xl">
            {greeting(hour)}, {first}
          </h1>
        </div>
        <div className="flex gap-2">
          <Link href="/assistant" className="btn-ghost">
            <Icon name="sparkle" size={16} />
            Ask
          </Link>
          <Link href="/resources" className="btn-primary">
            <Icon name="search" size={16} />
            Find a resource
          </Link>
        </div>
      </div>

      {user.suspended && <Notice tone="error" title="Booking privileges suspended">See your profile for the strikes on record and how to ask for a review.</Notice>}
      {!user.idVerified && (
        <Notice tone="warn" title="Identity not verified yet" action={<Link href="/profile" className="btn-ghost btn-sm">Profile</Link>}>
          Most resources stay locked until the facilities office checks your campus ID.
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-6">
          {next ? <NextBooking b={next.b} r={next.r} now={now} /> : (
            <div className="card enter p-2">
              <EmptyState
                illustration="spool"
                title="Nothing on your loom yet"
                description="Describe what you want to make and LoomLend shows what you can book, and why."
                action={<Link href="/resources" className="btn-primary">Discover resources</Link>}
                secondary={<Link href="/assistant" className="btn-ghost"><Icon name="sparkle" size={16} />Ask the concierge</Link>}
                className="border-0"
              />
            </div>
          )}

          {staffCounts && (
            <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { n: staffCounts.pending, label: "Requests to review", href: "/manage#requests", icon: "layers" as const, hot: staffCounts.pending > 0 },
                { n: staffCounts.returns, label: "Returns to confirm", href: "/manage#returns", icon: "box" as const, hot: staffCounts.returns > 0 },
                { n: staffCounts.active, label: "Items in use", href: "/manage#active", icon: "clock" as const, hot: false },
                { n: staffCounts.incidents, label: "Open incidents", href: "/manage#incidents", icon: "alert" as const, hot: staffCounts.incidents > 0 },
              ].map((s) => (
                <Link key={s.label} href={s.href} className="card group p-4">
                  <span className="flex items-center justify-between">
                    <span className={`grid size-8 place-items-center rounded-lg ${s.hot ? "bg-saffron-soft text-saffron" : "bg-sunken text-muted"}`}>
                      <Icon name={s.icon} size={16} />
                    </span>
                    <Icon name="arrowRight" size={16} className="text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-thread" />
                  </span>
                  <span className="h-display mt-3 block text-3xl font-semibold tabular">{s.n}</span>
                  <span className="text-sm text-muted">{s.label}</span>
                </Link>
              ))}
            </div>
          )}

          <Section title="Your bookings" icon="calendar" aside={<Link href="/bookings" className="text-sm font-medium text-thread hover:underline">All bookings</Link>}>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted">{next ? "Nothing else lined up." : "No active bookings."} <Link className="font-medium text-thread hover:underline" href="/resources">Find something to book</Link>.</p>
            ) : (
              <ul className="stagger -mx-2 divide-y divide-line">
                {upcoming.map(({ b, r }) => (
                  <li key={b.id}>
                    <Link href={`/bookings/${b.id}`} className="flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-sunken">
                      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-sunken text-xl" aria-hidden>{r.emoji}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{r.name}</span>
                        <span className="block text-sm text-muted tabular">
                          {fmtRange(b.start, b.end)} · <RelativeTime ms={b.start} now={now} />
                        </span>
                      </span>
                      {isOverdue(b, now) ? <Badge status="overdue" label="Overdue" /> : <Badge status={b.status} />}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Needs your attention" icon="flag" aside={todos.length > 0 ? <span className="rounded-full bg-saffron-soft px-2 py-0.5 text-xs font-semibold text-saffron tabular">{todos.length}</span> : undefined}>
            {todos.length === 0 ? (
              <EmptyState compact illustration="check" title="All caught up" description="Nothing is waiting on you right now." className="border-0" />
            ) : (
              <ul className="stagger space-y-2">
                {todos.slice(0, 6).map((t) => (
                  <li key={t.title}>
                    <Link href={t.href} className="group flex items-center gap-3 rounded-lg border border-line bg-field p-3 transition-colors hover:border-line-strong">
                      <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${{ danger: "bg-rose-soft text-rose", warn: "bg-amber-soft text-amber-ink", info: "bg-thread-soft text-thread", ok: "bg-teal-soft text-teal" }[t.tone]}`}>
                        <Icon name={t.icon} size={17} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{t.title}</span>
                        <span className="block truncate text-xs text-muted">{t.detail}</span>
                      </span>
                      <span className="text-xs font-semibold text-thread group-hover:underline">{t.cta}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Latest updates" icon="bell" aside={<Link href="/notifications" className="text-sm font-medium text-thread hover:underline">Inbox</Link>}>
            {notes.length === 0 ? (
              <EmptyState compact illustration="inbox" title="No updates yet" description="Approvals, reminders and waiting-list moves land here." className="border-0" />
            ) : (
              <ul className="stagger -mx-2 space-y-0.5">
                {notes.map((n) => (
                  <li key={n.id}>
                    <a href={`/notifications/${n.id}/open`} className="flex gap-3 rounded-lg px-2 py-2.5 text-sm transition-colors hover:bg-sunken">
                      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-saffron"}`} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className={`block ${n.read ? "text-ink/80" : "font-medium"}`}>
                          {!n.read && <span className="sr-only">Unread: </span>}
                          {n.title}
                        </span>
                        <span className="line-clamp-2 block text-muted">{n.body}</span>
                      </span>
                      <RelativeTime ms={n.createdAt} now={now} className="shrink-0 pt-0.5 text-xs text-subtle" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      {demoMode() && (
        <p className="flex items-start gap-2 text-xs text-muted">
          <Icon name="info" size={14} className="mt-px" />
          <span>
            Demo mode: check-in is allowed at any time during a booking day so judges can complete the full journey without waiting. Switch accounts from the{" "}
            <Link href="/login" className="underline underline-offset-2 hover:text-ink">sign-in page</Link>.
          </span>
        </p>
      )}
    </div>
  );
}

/** The hero card for the booking that matters most right now. */
function NextBooking({ b, r, now }: { b: Booking; r: Resource; now: number }) {
  const inUse = b.status === "checked_out";
  const overdue = isOverdue(b, now);
  const approved = b.status === "approved";
  const target = inUse ? b.end : b.start;
  return (
    <section aria-labelledby="next-title" className="card enter relative overflow-hidden p-0">
      <div className="weave absolute inset-0 opacity-60" aria-hidden />
      <div className="relative p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">{inUse ? "In use now" : approved ? "Your next booking" : "Next request"}</p>
          {overdue ? <Badge status="overdue" label="Overdue" /> : <Badge status={b.status} />}
        </div>
        <div className="mt-3 flex items-start gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl border border-line bg-card text-3xl shadow-1" aria-hidden>{r.emoji}</span>
          <div className="min-w-0">
            <h2 id="next-title" className="h-display text-xl font-semibold text-balance sm:text-2xl">{r.name}</h2>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
              <Icon name="pin" size={14} />
              {r.location}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <span className="flex items-center gap-1.5 tabular">
            <Icon name="clock" size={15} className="text-muted" />
            {fmtRange(b.start, b.end)}
          </span>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${overdue ? "bg-rose-soft text-rose" : "bg-thread-soft text-thread"}`}>
            <Icon name="hourglass" size={13} />
            {inUse ? (overdue ? "Was due " : "Due back ") : target > now ? "Starts " : "Started "}
            <RelativeTime ms={target} now={now} style="countdown" />
          </span>
          <CopyButton value={bookingRef(b.id)} showValue label="Copy booking reference" />
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {approved && (
            <Link href="/scan" className="btn-primary">
              <Icon name="scan" size={17} />
              Scan to check in
            </Link>
          )}
          {inUse && (
            <Link href={`/bookings/${b.id}`} className={overdue ? "btn-danger" : "btn-primary"}>
              <Icon name="undo" size={17} />
              Return it
            </Link>
          )}
          <Link href={`/bookings/${b.id}`} className="btn-ghost">
            View booking
          </Link>
          {(approved || b.status === "pending") && (
            <a href={`/api/bookings/${b.id}/ics`} className="btn-subtle" download>
              <Icon name="calendarPlus" size={17} />
              Add to calendar
            </a>
          )}
        </div>
        {!inUse && !approved && <p className="mt-3 text-xs text-muted">{STATUS_LABEL[b.status]}. You&apos;ll get a notification as soon as someone decides.</p>}
      </div>
    </section>
  );
}

async function Landing() {
  let stats = { resources: 0, departments: 0, hoursShared: 0, peopleServed: 0, loans: 0, inUse: 0 };
  let tags: { label: string; meta: string }[] = [];
  try {
    stats = await publicStats();
    const recent = await db
      .select({ name: schema.resources.name, start: schema.bookings.start, end: schema.bookings.end, status: schema.bookings.status })
      .from(schema.bookings)
      .innerJoin(schema.resources, eq(schema.resources.id, schema.bookings.resourceId))
      .where(inArray(schema.bookings.status, ["closed", "checked_out", "approved"]))
      .orderBy(desc(schema.bookings.start))
      .limit(12);
    const seen = new Set<string>();
    tags = recent
      .filter((x) => !seen.has(x.name) && seen.add(x.name))
      .map((x) => ({ label: x.name.split(" · ")[0], meta: `${Math.round((x.end - x.start) / HOUR)} h · ${x.status === "closed" ? "returned" : x.status === "checked_out" ? "in use now" : "approved"}` }));
  } catch {}

  const steps: { t: string; d: string; icon: IconName }[] = [
    { t: "List", d: "Owners publish hours, caps, training and supervision rules.", icon: "plus" },
    { t: "Discover", d: "Describe your need in plain words; see why each result matched.", icon: "compass" },
    { t: "Check", d: "An eligibility checklist shows what you meet and how to fix the rest.", icon: "shield" },
    { t: "Request", d: "A published priority score; a full slot means an explained waiting list.", icon: "calendarPlus" },
    { t: "Review", d: "A person approves, rejects or waitlists, always with a reason.", icon: "user" },
    { t: "Compete fairly", d: "Overlaps are waitlisted with explanations; cancellations promote the next.", icon: "scale" },
    { t: "Check in", d: "Scan the item's tag at the door and record its condition.", icon: "scan" },
    { t: "Return", d: "Record the condition again; a drop opens a damage report automatically.", icon: "undo" },
    { t: "Confirm", d: "The owner inspects; a manager resolves incidents and strikes.", icon: "check" },
    { t: "The Weave", d: "Every step lands in a hash-chained, tamper-evident history.", icon: "thread" },
  ];

  const pillars: { title: string; icon: IconName; points: string[]; href: string; link: string; tone: string }[] = [
    { title: "Trust at the hand-over", icon: "shield", tone: "bg-teal-soft text-teal", points: ["Verified ID and training before anything unlocks", "QR tags prove you're physically at the machine", "Condition photos at pick-up and return"], href: "/policy", link: "Read the rules" },
    { title: "Fair by construction", icon: "scale", tone: "bg-thread-soft text-thread", points: ["Weekly fair-share caps per resource", "A published priority formula, shown on every request", "Fair-draw rounds for the busiest machines"], href: "/fairness", link: "Open the fairness ledger" },
    { title: "AI that advises, people who decide", icon: "sparkle", tone: "bg-saffron-soft text-saffron", points: ["Claude summarises risk; it never approves or rejects", "A concierge that turns a sentence into a slot", "No names or emails are ever sent to the model"], href: "/login", link: "See it on a request" },
  ];

  const num = (n: number) => n.toLocaleString("en-IN");

  return (
    <div className="space-y-20 sm:space-y-24">
      {/* Hero */}
      <section className="grid items-center gap-10 pt-2 lg:grid-cols-[1.05fr_1fr] lg:gap-12 lg:pt-6">
        <div className="enter">
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1 text-xs font-medium text-muted shadow-1">
            <span className="size-1.5 rounded-full bg-teal" aria-hidden />
            Northfield Institute of Technology · live campus demo
          </p>
          <h1 className="h-display mt-5 text-[2.6rem] leading-[1.05] font-semibold tracking-tight text-balance sm:text-6xl">
            Idle labs, <em className="font-medium text-thread">woven</em> into shared opportunity.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-pretty text-ink/75">
            LoomLend lets a campus lend its laser cutters, oscilloscopes, studios and seminar halls to the students and researchers who need them, while owners keep
            control: training checks, supervised hand-overs, fair allocation and a full audit trail.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a href="#demo" className="btn-primary h-12 px-5 text-base">
              Try a demo account
              <Icon name="arrowRight" size={18} />
            </a>
            <Link href="/resources" className="btn-ghost h-12 px-5 text-base">
              Browse resources
            </Link>
          </div>
          <dl className="mt-10 grid max-w-lg grid-cols-3 gap-4 border-t border-line pt-6">
            {[
              [num(stats.resources), "resources listed", `across ${stats.departments} departments`],
              [num(stats.hoursShared), "hours shared", `${num(stats.loans)} loans so far`],
              [num(stats.peopleServed), "people served", stats.inUse ? `${stats.inUse} in use right now` : "and counting"],
            ].map(([n, l, h]) => (
              <div key={l}>
                <dt className="sr-only">{l}</dt>
                <dd className="h-display text-3xl font-semibold tabular sm:text-4xl">{n}</dd>
                <dd className="text-sm text-ink/80">{l}</dd>
                <dd className="text-xs text-muted">{h}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="enter mx-auto w-full max-w-[560px] px-3 [animation-delay:120ms] sm:px-4">
          <HeroWeave tags={tags} />
          <p className="mt-3 text-center text-xs text-muted">Every borrow is a thread on the loom: recent loans, live from the demo campus.</p>
        </div>
      </section>

      {/* Lifecycle */}
      <section aria-labelledby="how">
        <div className="mb-8 max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.14em] text-saffron uppercase">The lifecycle</p>
          <h2 id="how" className="h-display mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">Ten steps, one unbroken thread</h2>
          <p className="mt-2 text-muted">From listing to history, every step is checked by rules, decided by a person and recorded where both parties can see it.</p>
        </div>
        <ol className="stagger relative grid gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-5">
          <span aria-hidden className="absolute top-5 right-[10%] left-[10%] hidden h-0.5 bg-[repeating-linear-gradient(90deg,var(--thread)_0_10px,transparent_10px_16px)] opacity-40 lg:block" />
          <span aria-hidden className="absolute top-[calc(50%+1.25rem)] right-[10%] left-[10%] hidden h-0.5 bg-[repeating-linear-gradient(90deg,var(--saffron)_0_10px,transparent_10px_16px)] opacity-40 lg:block" />
          {steps.map((s, i) => (
            <li key={s.t} className="relative flex gap-4 lg:flex-col lg:gap-3">
              <span className={`relative z-[1] grid size-10 shrink-0 place-items-center rounded-full border-2 bg-card shadow-1 ${i < 5 ? "border-thread text-thread" : "border-saffron text-saffron"}`}>
                <Icon name={s.icon} size={18} />
              </span>
              <span>
                <span className="text-[11px] font-bold tracking-widest text-subtle tabular">{String(i + 1).padStart(2, "0")}</span>
                <span className="block font-semibold">{s.t}</span>
                <span className="block text-sm text-muted">{s.d}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/* Pillars */}
      <section aria-labelledby="pillars">
        <h2 id="pillars" className="sr-only">Why campuses trust it</h2>
        <div className="stagger grid gap-4 md:grid-cols-3">
          {pillars.map((p) => (
            <div key={p.title} className="card flex flex-col p-6">
              <span className={`grid size-11 place-items-center rounded-xl ${p.tone}`}>
                <Icon name={p.icon} size={22} />
              </span>
              <h3 className="h-display mt-4 text-xl font-semibold">{p.title}</h3>
              <ul className="mt-3 flex-1 space-y-2 text-sm text-ink/80">
                {p.points.map((x) => (
                  <li key={x} className="flex gap-2">
                    <Icon name="check" size={15} strokeWidth={2.2} className="mt-0.5 text-teal" />
                    {x}
                  </li>
                ))}
              </ul>
              <Link href={p.href} className="group mt-5 inline-flex items-center gap-1 text-sm font-medium text-thread">
                {p.link}
                <Icon name="arrowRight" size={15} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Personas */}
      <section id="demo" aria-labelledby="demo-title" className="scroll-mt-24">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-[0.14em] text-saffron uppercase">No sign-up needed</p>
            <h2 id="demo-title" className="h-display mt-1 text-3xl font-semibold tracking-tight">Jump in as anyone</h2>
            <p className="mt-1 text-sm text-muted">One click signs you in. Each person shows a different side of the workflow. All people and data are fictional.</p>
          </div>
          <Link href="/login" className="btn-ghost">
            All 12 demo people
            <Icon name="arrowRight" size={16} />
          </Link>
        </div>
        <DemoAccounts only={FEATURED} />
        <p className="mt-4 text-sm text-muted">
          <strong className="font-medium text-ink">Five-minute path:</strong> Meena lists a resource → Priya requests it → Meena approves → Priya checks in and returns it in “Fair” condition →
          Meena confirms (a damage report opens itself) → Dr. Arun resolves it.
        </p>
      </section>
    </div>
  );
}
