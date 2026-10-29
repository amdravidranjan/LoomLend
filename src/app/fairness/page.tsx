import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { fairnessLedger, WINDOW_DAYS, type ResourceLedger } from "@/lib/fairness";
import { GINI_ALERT } from "@/lib/inequality";
import { CREDIT_POINTS, MAX_CREDITS, OUTCOME_LABEL } from "@/lib/lottery";
import { sweep } from "@/lib/workflow";
import { HOUR, currentTime, fmtDateTime, fmtDay } from "@/lib/time";
import { Empty, PageHeader, Pill, Section } from "@/components/ui";
import { Countdown } from "./_components/countdown";
import { LorenzChart, Meter } from "./_components/lorenz";

const pct = (v: number) => `${Math.round(v * 100)}%`;

function giniWords(g: number) {
  if (g < 0.2) return "very even";
  if (g < 0.35) return "fairly even";
  if (g < GINI_ALERT) return "uneven";
  return "concentrated";
}

function fmtWait(h: number | null) {
  if (h === null) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} days`;
}

const METRICS: [string, string][] = [
  ["Gini coefficient", "0 means everyone who asked got the same number of hours; 1 means one person got all of them. People who asked and got nothing count as 0 h."],
  ["Lorenz curve", "Line people up from fewest to most hours: the curve shows what share of hours the bottom x% hold. The further it sags below the dashed line, the less equal."],
  ["Top 10% share", "How much of all hours went to the busiest tenth of people (at least one person)."],
  ["First-try success", "Of the people whose first request this month has been decided, how many got that very first request."],
  ["Median wait", "Typical time from going on a waiting list (or losing a draw) until leaving it: moved up, approved, cancelled, or the slot passed."],
  ["Credits outstanding", `Fairness credits held by people who missed out in a draw. Each is worth +${CREDIT_POINTS} priority (max ${MAX_CREDITS}) next time.`],
];

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-line bg-card p-3">
      <p className="label" title={hint}>{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted">{hint}</p>
    </div>
  );
}

function ResourceCard({ x, now }: { x: ResourceLedger; now: number }) {
  const r = x.resource;
  return (
    <article className={`card p-4 ${x.flagged ? "border-saffron" : ""}`} aria-labelledby={`res-${r.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={`res-${r.id}`} className="font-semibold">
          <Link href={`/resources/${r.id}`} className="hover:underline">
            <span aria-hidden>{r.emoji}</span> {r.name}
          </Link>
        </h3>
        <div className="flex flex-wrap gap-1">
          <Pill tone={r.allocationMode === "rounds" ? "info" : "plain"}>{r.allocationMode === "rounds" ? "Fair-draw rounds" : "Owner review"}</Pill>
          {x.flagged && <Pill tone="warn">Concentrated</Pill>}
        </div>
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-[180px_1fr]">
        <LorenzChart points={x.lorenz} gini={x.gini} title={`${r.name}: Lorenz curve of hours`} size={170} />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div><dt className="text-xs text-muted">Gini</dt><dd className="font-mono text-lg">{x.gini.toFixed(2)} <span className="font-sans text-xs text-muted">{giniWords(x.gini)}</span></dd></div>
          <div><dt className="text-xs text-muted">Top 10% hold</dt><dd className="font-mono text-lg">{pct(x.top10)}</dd></div>
          <div><dt className="text-xs text-muted">People · hours</dt><dd className="font-mono">{x.people} · {x.hours.toFixed(1)} h</dd></div>
          <div><dt className="text-xs text-muted">First-try success</dt><dd className="font-mono">{x.firstTry.rate === null ? "—" : `${pct(x.firstTry.rate)} of ${x.firstTry.n}`}</dd></div>
          <div><dt className="text-xs text-muted">Median wait</dt><dd className="font-mono">{fmtWait(x.medianWaitHours)}{x.waitSamples ? <span className="font-sans text-xs text-muted"> ({x.waitSamples})</span> : null}</dd></div>
          <div><dt className="text-xs text-muted">Credits outstanding</dt><dd className="font-mono">{x.creditsOutstanding}</dd></div>
        </dl>
      </div>
      {(x.openRounds.length > 0 || x.drawnRounds.length > 0) && (
        <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
          {x.openRounds.map((o) => (
            <li key={o.id}>
              <Link href={`/fairness/rounds/${o.id}`} className="text-thread hover:underline">Draw for {fmtDay(o.dayStart + 12 * HOUR)}</Link>{" "}
              <span className="text-muted">closes in <Countdown target={o.closesAt} now={now} title={`${fmtDateTime(o.closesAt)} IST`} /></span>
            </li>
          ))}
          {x.drawnRounds.slice(0, 3).map((o) => (
            <li key={o.id}>
              <Link href={`/fairness/rounds/${o.id}`} className="text-thread hover:underline">Draw for {fmtDay(o.dayStart + 12 * HOUR)}</Link>{" "}
              <span className="text-muted">drawn {fmtDateTime(o.drawnAt)} · verifiable</span>
            </li>
          ))}
        </ul>
      )}
      {x.flagged && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-soft px-3 py-2 text-sm text-amber-900">
          Hours here are concentrated (Gini above {GINI_ALERT}).{" "}
          {r.allocationMode === "rounds"
            ? `Suggestion for the owner: lower the fair-share cap (now ${r.weeklyHourCap} h per 7 days) so more people get a turn.`
            : `Suggestion for the owner: switch to fair-draw rounds or lower the fair-share cap (now ${r.weeklyHourCap} h per 7 days).`}
        </p>
      )}
    </article>
  );
}

export default async function FairnessPage() {
  await sweep();
  const user = await getCurrentUser();
  const now = currentTime();
  const L = await fairnessLedger(now, user);
  const active = L.resources.filter((x) => x.people > 0);
  const quiet = L.resources.filter((x) => x.people === 0);
  const open = L.resources.flatMap((x) => x.openRounds.map((o) => ({ o, r: x.resource }))).sort((a, b) => a.o.closesAt - b.o.closesAt);
  const drawn = L.resources
    .flatMap((x) => x.drawnRounds.map((o) => ({ o, r: x.resource })))
    .sort((a, b) => (b.o.drawnAt ?? 0) - (a.o.drawnAt ?? 0))
    .slice(0, 6);

  return (
    <div className="space-y-6">
      <PageHeader kicker={`Transparency · last ${WINDOW_DAYS} days`} title="Fairness ledger">
        <Link href="/policy#rounds" className="btn-ghost">How allocation works</Link>
      </PageHeader>
      <p className="max-w-3xl text-ink/80">
        Shared equipment should not quietly end up with the same few people. This page measures how evenly hours are spread, publicly, using the same data
        that drives decisions. Busy resources use <strong>fair-draw rounds</strong>: a weighted lottery whose random seed is locked in before anyone enters and
        which anyone can re-run in their browser.
      </p>

      <Section title="Campus at a glance">
        <div className="grid gap-6 md:grid-cols-[220px_1fr]">
          <LorenzChart points={L.campus.lorenz} gini={L.campus.gini} title="All resources: Lorenz curve of hours per person" size={210} />
          <div className="grid content-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Stat label="Gini (all resources)" value={L.campus.gini.toFixed(2)} hint={`${giniWords(L.campus.gini)}; 0 = perfectly even, 1 = one person has everything`} />
            <Stat label="Top 10% hold" value={pct(L.campus.top10)} hint="share of all hours used by the busiest tenth of people" />
            <Stat label="Hours allocated" value={`${Math.round(L.campus.hours)} h`} hint={`to ${L.campus.people} people who asked`} />
            <Stat label="Draws in 30 days" value={String(L.campus.roundsDrawn)} hint="each one independently verifiable" />
            <Stat label="Credits outstanding" value={String(L.campus.creditsOutstanding)} hint="boosts owed to people who missed out" />
            <Stat label="Resources flagged" value={String(L.campus.flagged)} hint={`Gini above ${GINI_ALERT}; owner nudged to act`} />
          </div>
        </div>
      </Section>

      {user && L.personal && (
        <Section title="Your fair share" aside={<span className="text-xs text-muted">Only you see this panel</span>}>
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="label">Hours you hold in the next/last 7 days vs the cap</h3>
              {L.personal.usage.length === 0 ? (
                <Empty>You have not used anything in the last {WINDOW_DAYS} days. When you do, your hours against each resource&apos;s weekly cap appear here.</Empty>
              ) : (
                <ul className="space-y-3">
                  {L.personal.usage.map((u) => (
                    <li key={u.resource.id} className="text-sm">
                      <div className="mb-1 flex flex-wrap justify-between gap-2">
                        <Link href={`/resources/${u.resource.id}`} className="hover:underline">{u.resource.emoji} {u.resource.name}</Link>
                        <span className="font-mono text-xs">
                          {u.hours7d.toFixed(1)} / {u.cap} h{u.credits ? ` · ${u.credits} credit${u.credits > 1 ? "s" : ""} (+${u.credits * CREDIT_POINTS})` : ""}
                        </span>
                      </div>
                      <Meter value={u.hours7d} max={u.cap} label={`${u.resource.name}: ${u.hours7d.toFixed(1)} of ${u.cap} hours`} />
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-muted">
                You hold {L.personal.totalCredits} fairness credit{L.personal.totalCredits === 1 ? "" : "s"} in total. Credits are earned when you miss out in a draw
                and are used up when you win one.
              </p>
            </div>
            <div>
              <h3 className="label">Your draws</h3>
              {L.personal.draws.length === 0 ? (
                <Empty>
                  You have not entered a draw yet. Busy resources such as the laser cutter pool requests for each day and draw them fairly; request a slot there to
                  enter.
                </Empty>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {L.personal.draws.map((d) => (
                    <li key={`${d.round.id}-${d.rank}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>
                        {d.resourceName} · {fmtDay(d.round.dayStart + 12 * HOUR)}
                        <span className="block text-xs text-muted">
                          Drawn {d.rank} of {d.entrants} · {d.outcome === "won" ? (d.overridden ? "won, then overridden by owner" : "won") : OUTCOME_LABEL[d.outcome].toLowerCase()}
                        </span>
                      </span>
                      <Link href={`/fairness/rounds/${d.round.id}`} className="text-thread hover:underline">Why? Verify →</Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={`Open draws (${open.length})`}>
          {open.length === 0 ? (
            <Empty>No draws are open. A draw opens when someone requests a busy resource for a future day; its seed fingerprint is published at once.</Empty>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {open.map(({ o, r }) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {r.emoji} {r.name} · {fmtDay(o.dayStart + 12 * HOUR)}
                    <span className="block text-xs text-muted">closes in <Countdown target={o.closesAt} now={now} title={`${fmtDateTime(o.closesAt)} IST`} /></span>
                  </span>
                  <Link href={`/fairness/rounds/${o.id}`} className="text-thread hover:underline">Commitment →</Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Recently drawn">
          {drawn.length === 0 ? (
            <Empty>No draws yet. Once a round closes, its seed is revealed and the full results appear here for anyone to check.</Empty>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {drawn.map(({ o, r }) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {r.emoji} {r.name} · {fmtDay(o.dayStart + 12 * HOUR)}
                    <span className="block text-xs text-muted">drawn {fmtDateTime(o.drawnAt)}</span>
                  </span>
                  <Link href={`/fairness/rounds/${o.id}`} className="text-thread hover:underline">Verify →</Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <section aria-labelledby="per-resource" className="space-y-3">
        <h2 id="per-resource" className="text-lg font-semibold">Per resource</h2>
        {active.length === 0 ? (
          <Empty>No requests in the last {WINDOW_DAYS} days yet, so there is nothing to measure.</Empty>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {active.map((x) => (
              <ResourceCard key={x.resource.id} x={x} now={now} />
            ))}
          </div>
        )}
        {quiet.length > 0 && (
          <p className="text-sm text-muted">No requests in {WINDOW_DAYS} days: {quiet.map((x) => x.resource.name).join(", ")}.</p>
        )}
      </section>

      <Section title="What the numbers mean">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {METRICS.map(([k, v]) => (
            <div key={k}>
              <dt className="font-medium">{k}</dt>
              <dd className="text-muted">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted">
          Hours count approved, in-use and completed bookings for slots in the last {WINDOW_DAYS} days or later. Names never appear on this page.
        </p>
      </Section>
    </div>
  );
}
