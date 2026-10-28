import Link from "next/link";
import { and, eq, gt, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { CATEGORIES, CERTS } from "@/lib/catalog";
import { profileChecks, parseList } from "@/lib/rules";
import { matchResources } from "@/lib/match";
import { DAY, HOUR, currentTime } from "@/lib/time";
import { Badge, Empty, PageHeader, Pill } from "@/components/ui";

export default async function ResourcesPage({ searchParams }: PageProps<"/resources">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const category = typeof sp.category === "string" ? sp.category : "";
  const dept = typeof sp.dept === "string" ? sp.dept : "";
  const eligibleOnly = sp.eligible === "1";

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
  const withElig = list.map((m) => {
    const checks = user ? profileChecks(user, m.r, certs) : [];
    const missing = checks.filter((c) => !c.pass);
    const weekHours = upcoming.filter((b) => b.resourceId === m.r.id && b.start < now + 7 * DAY).reduce((h, b) => h + (b.end - b.start) / HOUR, 0);
    const waiting = upcoming.filter((b) => b.resourceId === m.r.id && b.status === "waitlisted").length;
    return { ...m, missing, weekHours, waiting };
  });
  const shown = eligibleOnly && user ? withElig.filter((m) => m.missing.length === 0) : withElig;

  return (
    <div>
      <PageHeader kicker="Discover" title="What do you need to make?">
        {user && isStaff(user) && (
          <Link href="/resources/new" className="btn-primary">
            + List a resource
          </Link>
        )}
      </PageHeader>

      <form className="card mb-6 grid gap-3 p-4 md:grid-cols-[2fr_1fr_1fr_auto]" role="search">
        <div>
          <label htmlFor="q" className="label">Describe your need</label>
          <input id="q" name="q" defaultValue={q} className="input" placeholder="e.g. cut acrylic panels for an enclosure, record a podcast, train an ML model" />
        </div>
        <div>
          <label htmlFor="category" className="label">Type</label>
          <select id="category" name="category" defaultValue={category} className="input">
            <option value="">All types</option>
            {Object.entries(CATEGORIES).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="dept" className="label">Department</label>
          <select id="dept" name="dept" defaultValue={dept} className="input">
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col justify-end gap-2">
          {user && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="eligible" value="1" defaultChecked={eligibleOnly} className="accent-thread" /> Only what I can book
            </label>
          )}
          <button className="btn-primary">Search</button>
        </div>
      </form>

      {q && <p className="mb-3 text-sm text-muted">{shown.length} match{shown.length === 1 ? "" : "es"} for “{q}”, best first.</p>}

      {shown.length === 0 ? (
        <Empty>No resources match. Try fewer words or clear the filters.</Empty>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map(({ r, reasons, missing, weekHours, waiting }) => {
            const openHoursWeek = parseList<number>(r.openDays).length * (r.closeHour - r.openHour);
            const demand = openHoursWeek ? weekHours / openHoursWeek : 0;
            return (
              <li key={r.id}>
                <Link href={`/resources/${r.id}`} className="card flex h-full flex-col p-4 transition-colors hover:border-thread">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-3xl" aria-hidden>{r.emoji}</span>
                    <div className="flex flex-wrap justify-end gap-1">
                      {r.status !== "active" && <Badge status={r.status} />}
                      {demand > 0.25 && <Pill tone="warn">High demand</Pill>}
                      {waiting > 0 && <Pill tone="info">{waiting} waiting</Pill>}
                    </div>
                  </div>
                  <h2 className="mt-2 font-semibold">{r.name}</h2>
                  <p className="text-sm text-muted">{r.location}</p>
                  <p className="mt-2 line-clamp-2 text-sm text-ink/80">{r.description}</p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    <Pill>{CATEGORIES[r.category]}</Pill>
                    <Pill>≤ {r.maxHours} h / booking</Pill>
                    {r.supervisionRequired && <Pill tone="warn">Supervised</Pill>}
                    {r.autoApprove && <Pill tone="ok">Instant approval</Pill>}
                    {r.depositRequired > 0 && <Pill>₹{r.depositRequired} deposit</Pill>}
                  </div>
                  {reasons.length > 0 && <p className="mt-2 text-xs text-thread">Matched: {reasons.join(", ")}</p>}
                  <div className="mt-auto pt-3 text-sm">
                    {!user ? (
                      <span className="text-muted">{parseList(r.requiredCerts).length ? `Needs: ${parseList(r.requiredCerts).map((c) => CERTS[c]?.label).join(", ")}` : "No training needed"}</span>
                    ) : missing.length === 0 ? (
                      <span className="font-medium text-teal">✓ You meet every requirement</span>
                    ) : (
                      <span className="text-rose">Missing: {missing.map((m) => m.label.replace("Training: ", "")).join(", ")}</span>
                    )}
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
