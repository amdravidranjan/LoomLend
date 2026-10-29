import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { RANGES, fmtHours, fmtINR, fmtNum, fmtPct, impactScope, loadImpact, parseRange, type Totals } from "@/lib/impact";
import { ASSET_LIFE_YEARS, RETURN_GRACE_MIN } from "@/lib/impact-math";
import { currentTime, fmtDay } from "@/lib/time";
import { PageHeader, Section } from "@/components/ui";
import { Sparkline } from "@/components/charts/sparkline";
import { BarList } from "@/components/charts/bars";
import { Heatmap } from "@/components/charts/heatmap";
import { FlowMatrix } from "@/components/charts/flow-matrix";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Impact · LoomLend" };

type Kpi = {
  key: keyof Totals;
  label: string;
  value: string;
  soWhat: string;
  trend: number[];
  /** Is a higher number good news? */
  upIsGood: boolean;
  delta?: { text: string; good: boolean } | null;
};

function delta(cur: number | null, prev: number | null | undefined, kind: "pct-points" | "relative", upIsGood: boolean) {
  if (cur === null || prev === null || prev === undefined) return null;
  if (kind === "pct-points") {
    const d = Math.round((cur - prev) * 100);
    if (!d) return { text: "No change vs previous period", good: true };
    return { text: `${d > 0 ? "▲" : "▼"} ${Math.abs(d)} pts vs previous period`, good: d > 0 === upIsGood };
  }
  if (!prev) return null;
  const d = Math.round(((cur - prev) / prev) * 100);
  if (!d) return { text: "No change vs previous period", good: true };
  return { text: `${d > 0 ? "▲" : "▼"} ${Math.abs(d)}% vs previous period`, good: d > 0 === upIsGood };
}

export default async function ImpactPage({ searchParams }: PageProps<"/impact">) {
  const user = await requireUser();
  const sp = await searchParams;
  const scope = impactScope(user, typeof sp.dept === "string" ? sp.dept : null);
  if (!scope) redirect("/?denied=1");
  const days = parseRange(sp.days);
  const now = currentTime();
  const r = await loadImpact(scope, days, now);
  const t = r.totals;
  const p = r.previous;
  const trend = (k: keyof Totals) => r.trend.map((w) => Number(w[k] ?? 0));
  const qs = (o: Record<string, string | number | null>) => {
    const u = new URLSearchParams();
    const merged = { days, dept: scope.canPickDepartment ? scope.department : null, ...o };
    for (const [k, v] of Object.entries(merged)) if (v !== null && v !== undefined && v !== "") u.set(k, String(v));
    return `?${u.toString()}`;
  };

  const topCross = (() => {
    let best = { from: "", to: "", h: 0 };
    r.matrix.borrowerDepts.forEach((b, bi) => r.matrix.ownerDepts.forEach((o, oi) => b !== o && r.matrix.hours[bi][oi] > best.h && (best = { from: b, to: o, h: r.matrix.hours[bi][oi] })));
    return best;
  })();
  const busiest = r.resources.filter((x) => x.status === "active")[0];
  const idlest = [...r.resources].filter((x) => x.status === "active" && x.openHours > 0).sort((a, b) => a.utilisation - b.utilisation)[0];
  const recs = r.resources.filter((x) => x.recommendation).sort((a, b) => (a.recommendation!.paybackMonths ?? 999) - (b.recommendation!.paybackMonths ?? 999));
  const unmet = r.resources.filter((x) => x.unmetHours > 0).sort((a, b) => b.unmetHours - a.unmetHours);
  const perMonth = (v: number) => (v / r.days) * 30;

  const kpis: Kpi[] = [
    {
      key: "bookedHours",
      label: "Hours shared",
      value: fmtHours(t.bookedHours),
      soWhat: `${fmtNum(t.uses)} completed loans: time that kit and rooms would otherwise have sat locked.`,
      trend: trend("bookedHours"),
      upIsGood: true,
      delta: delta(t.bookedHours, p?.bookedHours, "relative", true),
    },
    {
      key: "utilisation",
      label: "Utilisation",
      value: fmtPct(t.utilisation),
      soWhat: `Booked hours ÷ open hours. ${fmtHours(Math.max(0, t.openHours - t.bookedHours))} of open time is still idle and could be lent.`,
      trend: trend("utilisation"),
      upIsGood: true,
      delta: delta(t.utilisation, p?.utilisation, "pct-points", true),
    },
    {
      key: "crossDeptHours",
      label: "Idle hours unlocked",
      value: fmtHours(t.crossDeptHours),
      soWhat: "Hours used by people outside the owning department: capacity that only exists because it is shared.",
      trend: trend("crossDeptHours"),
      upIsGood: true,
      delta: delta(t.crossDeptHours, p?.crossDeptHours, "relative", true),
    },
    {
      key: "people",
      label: "People served",
      value: fmtNum(t.people),
      soWhat: "Distinct students, researchers and staff who got hands-on time.",
      trend: trend("people"),
      upIsGood: true,
      delta: delta(t.people, p?.people, "relative", true),
    },
    {
      key: "crossDeptShare",
      label: "Cross-department share",
      value: fmtPct(t.crossDeptShare),
      soWhat: topCross.h ? `Biggest flow: ${topCross.from} using ${topCross.to} kit (${fmtHours(topCross.h)}).` : "Share of hours borrowed across department lines.",
      trend: trend("crossDeptShare"),
      upIsGood: true,
      delta: delta(t.crossDeptShare, p?.crossDeptShare, "pct-points", true),
    },
    {
      key: "unmetHours",
      label: "Unmet demand",
      value: fmtHours(t.unmetHours),
      soWhat: unmet[0] ? `Requests turned away for lack of capacity; ${unmet[0].name.split(" · ")[0]} accounts for ${fmtPct(unmet[0].unmetHours / Math.max(1, t.unmetHours))}.` : "No requests were turned away for lack of capacity.",
      trend: trend("unmetHours"),
      upIsGood: false,
      delta: delta(t.unmetHours, p?.unmetHours, "relative", false),
    },
    {
      key: "onTimeRate",
      label: "On-time returns",
      value: fmtPct(t.onTimeRate),
      soWhat: `Returned within ${RETURN_GRACE_MIN} min of the slot end. Late returns are flagged automatically.`,
      trend: trend("onTimeRate"),
      upIsGood: true,
      delta: delta(t.onTimeRate, p?.onTimeRate, "pct-points", true),
    },
    {
      key: "incidentsPer100",
      label: "Incidents per 100 loans",
      value: t.incidentsPer100 === null ? "—" : t.incidentsPer100.toFixed(1),
      soWhat: "Damage, delay or misuse reports. Every one is reviewed by a manager with a recorded outcome.",
      trend: trend("incidentsPer100"),
      upIsGood: false,
      delta: t.incidentsPer100 !== null && p?.incidentsPer100 != null ? delta(t.incidentsPer100, p.incidentsPer100, "relative", false) : null,
    },
  ];

  const rangeText = `${fmtDay(r.from)} – ${fmtDay(r.to)}`;
  const csvHref = `/impact/export${qs({})}`;

  return (
    <div className="space-y-6">
      <div className="hidden print:block">
        <p className="text-xs text-muted">LoomLend impact report · prepared for the Principal · generated {fmtDay(now)}</p>
      </div>
      <PageHeader kicker={`Impact report · ${scope.label}`} title="What sharing unlocked">
        <p className="w-full text-sm text-muted sm:w-auto">
          Last {days} days · {rangeText}
        </p>
      </PageHeader>

      <div className="no-print flex flex-wrap items-center gap-2" role="group" aria-label="Report filters">
        <nav aria-label="Date range" className="inline-flex rounded-lg border border-line bg-card p-0.5">
          {RANGES.map((d) => (
            <Link
              key={d}
              href={qs({ days: d })}
              aria-current={d === days ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm ${d === days ? "bg-thread-soft font-semibold text-thread" : "text-muted hover:text-ink"}`}
            >
              {d} days
            </Link>
          ))}
        </nav>
        {scope.canPickDepartment && (
          <form method="get" className="flex items-center gap-2">
            <input type="hidden" name="days" value={days} />
            <label htmlFor="dept" className="sr-only">
              Department
            </label>
            <select id="dept" name="dept" defaultValue={scope.department ?? "all"} className="input w-auto py-1.5">
              <option value="all">Whole campus</option>
              {r.departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <button className="btn-ghost py-1.5" type="submit">
              Apply
            </button>
          </form>
        )}
        <span className="ml-auto flex gap-2">
          <a className="btn-ghost" href={csvHref} download>
            Download CSV
          </a>
          <PrintButton />
        </span>
      </div>

      {/* Hero figure: the one number the principal will repeat. */}
      <section className="card p-6 sm:p-8">
        <p className="text-sm font-medium text-muted">Saved vs renting the same hours outside campus</p>
        <p className="mt-1 text-5xl font-semibold tracking-tight text-ink sm:text-6xl">{fmtINR(t.saved)}</p>
        <p className="mt-3 max-w-2xl text-sm text-ink">
          In {days} days, {fmtNum(t.people)} people used {fmtHours(t.bookedHours)} of shared equipment and space. Renting the same time from outside makers&apos; spaces,
          studios and cloud GPUs would have cost about {fmtINR(t.saved)}
          {days < 365 ? `, roughly ${fmtINR((t.saved / days) * 365)} a year at this pace` : ""}.
        </p>
        {p && <p className="mt-1 text-xs text-muted">Previous {days} days: {fmtINR(p.saved)}.</p>}
      </section>

      <section aria-label="Key indicators" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <article key={k.key} className="card flex flex-col p-4">
            <h2 className="text-xs font-medium text-muted">{k.label}</h2>
            <div className="mt-1 flex items-end justify-between gap-2">
              <p className="text-2xl font-semibold text-ink">{k.value}</p>
              <Sparkline values={k.trend} label={`${k.label}, weekly trend over the last ${days} days`} />
            </div>
            {k.delta && (
              <p className={`mt-1 text-xs font-medium ${k.delta.good ? "text-teal" : "text-rose"}`}>
                <span className="sr-only">{k.delta.good ? "Good news: " : "Needs attention: "}</span>
                {k.delta.text}
              </p>
            )}
            <p className="mt-2 text-xs leading-relaxed text-muted">{k.soWhat}</p>
          </article>
        ))}
      </section>

      {recs.length > 0 && (
        <Section title="Recommendations">
          <ul className="space-y-3">
            {recs.map((x) => (
              <li key={x.id} className="rounded-lg border border-line bg-[var(--sunken)] p-4">
                <p className="text-sm font-semibold text-ink">
                  <span aria-hidden>{x.emoji} </span>
                  {x.recommendation!.kind === "second_unit" ? `Consider a second ${x.name.split(" · ")[0]}` : `Extend hours for ${x.name.split(" · ")[0]}`}
                </p>
                <p className="mt-1 text-sm text-ink">{x.recommendation!.text}</p>
                <p className="mt-1 text-xs text-muted">
                  Based on {fmtHours(x.unmetHours)} turned away in {days} days at {fmtPct(x.utilisation)} utilisation; purchase price {x.purchaseValue ? fmtINR(x.purchaseValue) : "n/a"},
                  outside rental {fmtINR(x.marketRatePerHour)}/h.
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Utilisation by resource">
          <p className="-mt-1 mb-3 text-xs text-muted">
            Booked hours as a share of opening hours.{" "}
            {busiest && idlest && busiest.id !== idlest.id
              ? `${busiest.name.split(" · ")[0]} is the busiest; ${idlest.name.split(" · ")[0]} sits idle ${fmtPct(1 - idlest.utilisation)} of the time and could be offered more widely.`
              : ""}
          </p>
          <BarList
            title="Utilisation by resource"
            description="Booked hours divided by open hours, per resource, highest first."
            unitLabel="Utilisation"
            max={1}
            data={r.resources.map((x) => ({
              key: x.id,
              label: x.name.split(" · ")[0],
              value: x.utilisation,
              display: x.status === "active" ? fmtPct(x.utilisation) : x.status,
              note: `${fmtHours(x.bookedHours)} of ${fmtHours(x.openHours)} open · ${fmtNum(x.uses)} loans`,
            }))}
          />
        </Section>
        <Section title="Unmet demand">
          <p className="-mt-1 mb-3 text-xs text-muted">
            Hours requested but turned away: waiting list never reached, slot already taken, or the fair-share cap. This is the case for more capacity.
          </p>
          {unmet.length ? (
            <BarList
              title="Unmet demand by resource"
              description="Requested hours that could not be served, per resource."
              unitLabel="Hours turned away"
              tone="unmet"
              max={Math.max(...unmet.map((x) => x.unmetHours))}
              data={unmet.map((x) => ({
                key: x.id,
                label: x.name.split(" · ")[0],
                value: x.unmetHours,
                display: fmtHours(x.unmetHours),
                note: `${fmtNum(x.unmetRequests)} requests · waiting list ${fmtNum(x.unmetByKind.waitlist)} h, taken ${fmtNum(x.unmetByKind.taken)} h, cap ${fmtNum(x.unmetByKind.cap)} h · ~${fmtNum(perMonth(x.unmetHours))} h/month`,
              }))}
            />
          ) : (
            <p className="text-sm text-muted">Nothing was turned away in this period.</p>
          )}
        </Section>
      </div>

      <Section title="When demand peaks">
        <p className="-mt-1 mb-3 text-xs text-muted">Every requested hour by day and time, campus time. Busy weekday afternoons are where extra units or extended hours pay off first.</p>
        <Heatmap
          title="Requested hours by day of week and hour"
          description={`Requested hours (served or turned away) over the last ${days} days, grouped by weekday and hour.`}
          days={r.heatmap.days}
          hours={r.heatmap.hours}
          values={r.heatmap.demand}
        />
      </Section>

      <Section title="Who borrows from whom">
        <p className="-mt-1 mb-3 text-xs text-muted">
          The core value of sharing: {fmtPct(t.crossDeptShare)} of hours went to people outside the department that owns the resource.
        </p>
        {r.matrix.borrowerDepts.length ? (
          <FlowMatrix
            title="Hours borrowed, by borrower department and owning department"
            description="Shading is relative to the largest flow."
            rows={r.matrix.borrowerDepts}
            cols={r.matrix.ownerDepts}
            hours={r.matrix.hours}
          />
        ) : (
          <p className="text-sm text-muted">No loans in this period.</p>
        )}
      </Section>

      <Section title="Value per resource">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Value per resource</caption>
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th scope="col" className="py-2 pr-3 font-medium">Resource</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Hours</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Saved</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Cost per use</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Rent per use</th>
                <th scope="col" className="py-2 text-right font-medium">On time</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {r.resources.map((x) => (
                <tr key={x.id} className="border-b border-line/60">
                  <td className="py-2 pr-3">
                    <Link href={`/resources/${x.id}`} className="hover:text-thread">
                      <span aria-hidden>{x.emoji} </span>
                      {x.name.split(" · ")[0]}
                    </Link>
                    <span className="block text-xs text-muted">{x.department}</span>
                  </td>
                  <td className="py-2 pr-3 text-right">{fmtNum(x.bookedHours)}</td>
                  <td className="py-2 pr-3 text-right">{fmtINR(x.saved)}</td>
                  <td className="py-2 pr-3 text-right">{x.costPerUse === null ? "—" : fmtINR(x.costPerUse)}</td>
                  <td className="py-2 pr-3 text-right">{x.rentPerUse === null ? "—" : fmtINR(x.rentPerUse)}</td>
                  <td className="py-2 text-right">{fmtPct(x.onTimeRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted">
          Cost per use = purchase price spread over a {ASSET_LIFE_YEARS}-year life for this period, divided by loans. When it is below the rent per use, owning and sharing beats renting;
          when it is far above, the asset is underused.
        </p>
      </Section>

      <section className="text-xs leading-relaxed text-muted">
        <h2 className="mb-1 font-semibold text-ink">How these numbers are calculated</h2>
        <p>
          Hours shared count loans that were picked up (no-shows excluded), clipped to the period. Open hours come from each listing&apos;s opening days and hours. Savings use each
          resource&apos;s outside rental rate per hour set by its owner. Unmet demand counts waiting-list entries whose slot passed, and requests rejected because the slot was taken
          or the fair-share cap was reached; policy rejections (for example banned materials) are excluded. Department figures use the borrower&apos;s home department only; no names
          are shown. In this demo, history before this week is synthetic and every person in it is fictional.
        </p>
      </section>
    </div>
  );
}
