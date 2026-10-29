import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, gt, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { CATEGORIES, CERTS } from "@/lib/catalog";
import { profileChecks, parseList } from "@/lib/rules";
import { matchResources } from "@/lib/match";
import { DAY, HOUR, currentTime } from "@/lib/time";
import { Badge, PageHeader, Pill } from "@/components/ui";
import { Icon, type IconName } from "@/components/ds/icons";
import { EmptyState, Kbd, Tooltip } from "@/components/ds/primitives";
import { DiscoverMemory, FilterForm } from "@/components/ds/filter-form";

export const metadata: Metadata = { title: "Discover · LoomLend" };

const SORTS = {
  match: "Best match",
  available: "Most available",
  instant: "Instant approval first",
  name: "Name A–Z",
} as const;
type Sort = keyof typeof SORTS;

const CAT_ICON: Record<string, IconName> = { space: "home", equipment: "wrench", tool: "wrench", device: "monitor" };

export default async function ResourcesPage({ searchParams }: PageProps<"/resources">) {
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const q = str("q");
  const category = str("category");
  const dept = str("dept");
  const eligibleOnly = sp.eligible === "1";
  const sort: Sort = (str("sort") in SORTS ? str("sort") : "match") as Sort;

  const user = await getCurrentUser();
  const all = await db.select().from(schema.resources).where(inArray(schema.resources.status, ["active", "maintenance"]));
  const certs = user ? await db.select().from(schema.certifications).where(eq(schema.certifications.userId, user.id)) : [];
  const now = currentTime();
  const upcoming = await db
    .select()
    .from(schema.bookings)
    .where(and(inArray(schema.bookings.status, ["approved", "pending", "waitlisted", "checked_out"]), gt(schema.bookings.end, now), gt(schema.bookings.start, now - DAY)));

  const departments = [...new Set(all.map((r) => r.department))].sort();
  const list = matchResources(q, all.filter((r) => (!category || r.category === category) && (!dept || r.department === dept)));
  const withElig = list.map((m, rank) => {
    const checks = user ? profileChecks(user, m.r, certs) : [];
    const missing = checks.filter((c) => !c.pass);
    const weekHours = upcoming.filter((b) => b.resourceId === m.r.id && b.start < now + 7 * DAY).reduce((h, b) => h + (b.end - b.start) / HOUR, 0);
    const waiting = upcoming.filter((b) => b.resourceId === m.r.id && b.status === "waitlisted").length;
    const inUse = upcoming.some((b) => b.resourceId === m.r.id && b.status === "checked_out");
    const openHoursWeek = parseList<number>(m.r.openDays).length * (m.r.closeHour - m.r.openHour);
    const demand = openHoursWeek ? weekHours / openHoursWeek : 0;
    return { ...m, rank, checks, missing, waiting, inUse, demand };
  });
  let shown = eligibleOnly && user ? withElig.filter((m) => m.missing.length === 0) : withElig;
  shown = [...shown].sort((a, b) => {
    if (sort === "name") return a.r.name.localeCompare(b.r.name);
    if (sort === "available") return a.demand - b.demand || a.rank - b.rank;
    if (sort === "instant") return Number(b.r.autoApprove) - Number(a.r.autoApprove) || a.rank - b.rank;
    return a.rank - b.rank;
  });
  const bookableCount = user ? withElig.filter((m) => m.missing.length === 0 && m.r.status === "active").length : 0;

  // Active filters as removable chips.
  const base = { q, category, dept, eligible: eligibleOnly ? "1" : "", sort: sort === "match" ? "" : sort };
  const hrefWithout = (key: keyof typeof base) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(base)) if (v && k !== key) p.set(k, v);
    const s = p.toString();
    return `/resources${s ? `?${s}` : ""}`;
  };
  const chips: { key: keyof typeof base; label: string }[] = [
    ...(q ? [{ key: "q" as const, label: `“${q}”` }] : []),
    ...(category ? [{ key: "category" as const, label: CATEGORIES[category as keyof typeof CATEGORIES] ?? category }] : []),
    ...(dept ? [{ key: "dept" as const, label: dept }] : []),
    ...(eligibleOnly ? [{ key: "eligible" as const, label: "Only what I can book" }] : []),
    ...(sort !== "match" ? [{ key: "sort" as const, label: SORTS[sort] }] : []),
  ];
  const currentQs = new URLSearchParams(Object.entries(base).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <div>
      <PageHeader
        kicker="Discover"
        title="What do you need to make?"
        description={user ? `${bookableCount} of ${withElig.length} resources here are ready for you to book today.` : "Browse freely. Sign in to see exactly which requirements you meet."}
      >
        {user && isStaff(user) && (
          <Link href="/resources/new" className="btn-primary">
            <Icon name="plus" size={16} />
            List a resource
          </Link>
        )}
      </PageHeader>

      <DiscoverMemory current={currentQs} labels={chips.map((c) => c.label).join(" · ")} />

      <FilterForm action="/resources" className="card mb-5 space-y-4 p-4 sm:p-5">
        <div className="flex flex-col gap-3 md:flex-row">
          <div className="relative flex-1">
            <label htmlFor="q" className="sr-only">Describe your need</label>
            <Icon name="search" size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={q}
              data-page-search
              className="input h-12 pr-12 pl-10 text-base"
              placeholder="Describe your need: cut acrylic panels, record a podcast, train a model…"
              autoComplete="off"
              enterKeyHint="search"
            />
            <Kbd className="absolute top-1/2 right-3 hidden -translate-y-1/2 sm:inline-flex">/</Kbd>
          </div>
          <button className="btn-primary h-12 px-6">Search</button>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <fieldset className="flex flex-wrap gap-1.5">
            <legend className="sr-only">Type</legend>
            {[["", "All types"] as const, ...Object.entries(CATEGORIES)].map(([k, v]) => (
              <label
                key={k}
                className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-field px-3 text-sm text-ink/80 transition-colors select-none hover:border-line-strong has-[:checked]:border-thread has-[:checked]:bg-thread-soft has-[:checked]:font-medium has-[:checked]:text-thread has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-thread"
              >
                <input type="radio" name="category" value={k} defaultChecked={category === k} className="sr-only" />
                {k && <Icon name={CAT_ICON[k]} size={14} />}
                {v}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <label className="sr-only" htmlFor="dept">Department</label>
            <select id="dept" name="dept" defaultValue={dept} className="input h-9 min-h-9 w-auto py-0 text-sm">
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
            <label className="sr-only" htmlFor="sort">Sort by</label>
            <select id="sort" name="sort" defaultValue={sort === "match" ? "" : sort} className="input h-9 min-h-9 w-auto py-0 text-sm">
              {Object.entries(SORTS).map(([k, v]) => (
                <option key={k} value={k === "match" ? "" : k}>
                  Sort: {v}
                </option>
              ))}
            </select>
            {user && (
              <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full border border-line bg-field px-3 text-sm select-none has-[:checked]:border-teal-200 has-[:checked]:bg-teal-soft has-[:checked]:text-teal has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-thread">
                <input type="checkbox" name="eligible" value="1" defaultChecked={eligibleOnly} className="peer sr-only" />
                <span className="relative h-4 w-7 rounded-full bg-line-strong transition-colors peer-checked:bg-teal after:absolute after:top-0.5 after:left-0.5 after:size-3 after:rounded-full after:bg-[#fff] after:transition-transform peer-checked:after:translate-x-3" aria-hidden />
                Only what I can book
              </label>
            )}
          </div>
        </div>
      </FilterForm>

      <div className="mb-4 flex min-h-8 flex-wrap items-center gap-2 text-sm" aria-live="polite">
        <p className="mr-1 text-muted">
          <strong className="font-semibold text-ink tabular">{shown.length}</strong> resource{shown.length === 1 ? "" : "s"}
          {q ? ", best match first" : ""}
        </p>
        {chips.map((c) => (
          <Link
            key={c.key}
            href={hrefWithout(c.key)}
            scroll={false}
            className="group inline-flex items-center gap-1 rounded-full border border-line bg-card py-0.5 pr-1.5 pl-2.5 text-xs font-medium text-ink/85 hover:border-rose-200 hover:text-rose"
            aria-label={`Remove filter ${c.label}`}
          >
            {c.label}
            <Icon name="x" size={12} strokeWidth={2.4} className="text-muted group-hover:text-rose" />
          </Link>
        ))}
        {chips.length > 1 && (
          <Link href="/resources" scroll={false} className="text-xs font-medium text-muted underline-offset-2 hover:text-ink hover:underline">
            Clear all
          </Link>
        )}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          illustration="loom"
          title="Nothing matches that yet"
          description={eligibleOnly ? "Nothing here is bookable for you yet. Turn off “Only what I can book” to see what training would unlock." : "Try fewer or simpler words, or clear a filter."}
          action={<Link href="/resources" className="btn-primary">Clear filters</Link>}
          secondary={user ? <Link href={`/assistant${q ? `?q=${encodeURIComponent(q)}` : ""}`} className="btn-ghost"><Icon name="sparkle" size={16} />Ask the concierge</Link> : undefined}
        />
      ) : (
        <ul className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map(({ r, reasons, missing, checks, waiting, inUse, demand }) => {
            const needs = parseList(r.requiredCerts);
            const ready = user && missing.length === 0 && r.status === "active";
            return (
              <li key={r.id}>
                <Link href={`/resources/${r.id}`} className="card group flex h-full flex-col p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="grid size-12 place-items-center rounded-xl bg-sunken text-2xl transition-transform group-hover:scale-105" aria-hidden>{r.emoji}</span>
                    <div className="flex flex-wrap justify-end gap-1">
                      {r.status !== "active" && <Badge status={r.status} />}
                      {inUse && r.status === "active" && <Badge status="checked_out" label="In use now" />}
                      {demand > 0.25 && <Pill tone="warn" icon="chart">High demand</Pill>}
                      {waiting > 0 && <Pill tone="info" icon="hourglass">{waiting} waiting</Pill>}
                    </div>
                  </div>
                  <h2 className="mt-3 font-semibold text-balance group-hover:text-thread">{r.name}</h2>
                  <p className="mt-0.5 flex items-center gap-1 text-sm text-muted">
                    <Icon name="pin" size={13} />
                    <span className="truncate">{r.location}</span>
                  </p>
                  <p className="mt-2 line-clamp-2 text-sm text-ink/80">{r.description}</p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    <Pill>{CATEGORIES[r.category]}</Pill>
                    <Pill icon="clock">≤ {r.maxHours} h</Pill>
                    {r.supervisionRequired && <Pill tone="warn" icon="user">Supervised</Pill>}
                    {r.autoApprove && <Pill tone="ok" icon="check">Instant approval</Pill>}
                    {r.depositRequired > 0 && <Pill>₹{r.depositRequired.toLocaleString("en-IN")} deposit</Pill>}
                  </div>
                  {reasons.length > 0 && (
                    <p className="mt-3 flex items-start gap-1.5 text-xs text-thread">
                      <Icon name="sparkle" size={13} className="mt-px" />
                      <span>Matched {reasons.join(", ")}</span>
                    </p>
                  )}
                  <div className="mt-auto pt-4">
                    <div className="border-t border-line pt-3 text-sm">
                      {!user ? (
                        <span className="flex items-center gap-1.5 text-muted">
                          <Icon name={needs.length ? "lock" : "check"} size={14} />
                          {needs.length ? `Needs ${needs.map((c) => CERTS[c]?.label).join(", ")}` : "No training needed"}
                        </span>
                      ) : ready ? (
                        <span className="flex items-center gap-1.5 font-medium text-teal">
                          <span className="grid size-5 place-items-center rounded-full bg-teal-soft"><Icon name="check" size={12} strokeWidth={3} /></span>
                          You meet all {checks.length} requirements
                        </span>
                      ) : missing.length === 0 ? (
                        <span className="flex items-center gap-1.5 text-muted"><Icon name="wrench" size={14} />Eligible · back after maintenance</span>
                      ) : (
                        <Tooltip label={missing.map((m) => m.fixHint ?? m.label).join(" · ")} className="w-full">
                          <span className="flex w-full items-center gap-2">
                            <span className="flex items-center gap-1.5 text-rose">
                              <Icon name="lock" size={14} />
                              <span className="tabular">{checks.length - missing.length}/{checks.length}</span>
                            </span>
                            <span className="min-w-0 flex-1 truncate text-muted">Missing {missing.map((m) => m.label.replace("Training: ", "")).join(", ")}</span>
                          </span>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
