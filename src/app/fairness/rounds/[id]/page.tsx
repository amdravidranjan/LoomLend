import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { canManageResource, getCurrentUser } from "@/lib/auth";
import { entriesOf, parseLog } from "@/lib/allocation";
import { CREDIT_POINTS, KEY_FORMULA, MAX_CREDITS, OUTCOME_LABEL, U_FORMULA, WEIGHT_FORMULA, weightFromScore } from "@/lib/lottery";
import { demoMode, sweep } from "@/lib/workflow";
import { HOUR, currentTime, fmtDateTime, fmtDay, fmtTime } from "@/lib/time";
import { runDrawNowAction } from "@/app/actions-allocation";
import { ActionForm, Submit } from "@/components/forms";
import { Empty, Notice, PageHeader, Pill, Section } from "@/components/ui";
import { CopyHash } from "../../_components/copy-hash";
import { Countdown } from "../../_components/countdown";
import { VerifyInBrowser } from "./verify";

export const metadata = { title: "Verify a draw · LoomLend" };

export default async function RoundPage({ params }: PageProps<"/fairness/rounds/[id]">) {
  const { id } = await params;
  await sweep();
  const round = await db.query.allocationRounds.findFirst({ where: eq(schema.allocationRounds.id, id) });
  if (!round) notFound();
  const resource = (await db.query.resources.findFirst({ where: eq(schema.resources.id, round.resourceId) }))!;
  const user = await getCurrentUser();
  const now = currentTime();
  const manage = user ? canManageResource(user, resource) : false;
  const entries = await entriesOf(round.id);
  const mine = new Set(entries.filter((b) => b.userId === user?.id).map((b) => b.id));
  const log = parseLog(round);
  const day = fmtDay(round.dayStart + 12 * HOUR);

  // Pseudonyms for an open round: entrant numbers in order of first entry, like the draw itself uses.
  const live = entries.filter((b) => b.status === "pending");
  const personOf = new Map<string, number>();
  for (const b of live) if (!personOf.has(b.userId)) personOf.set(b.userId, personOf.size + 1);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <p className="text-sm">
        <Link href="/fairness" className="text-thread hover:underline">← Fairness ledger</Link>
      </p>
      <PageHeader kicker={`Fair draw · ${resource.name}`} title={`Draw for ${day}`}>
        <Pill tone={round.status === "open" ? "info" : "ok"}>{round.status === "open" ? "Open for entries" : "Drawn"}</Pill>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Section title="Commit, then reveal">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="label">Seed commitment (published {fmtDateTime(round.createdAt)})</dt>
              <dd><CopyHash value={round.seedCommitment} label="commitment" /></dd>
              <dd className="mt-1 text-xs text-muted">
                The <abbr title="SHA-256 fingerprint of the secret random seed. Anyone can check the seed against it later, but nobody can work out the seed from it.">commitment</abbr>{" "}
                was fixed when the first request arrived, before anyone could see who entered. Changing the seed later would change this fingerprint.
              </dd>
            </div>
            {round.status === "open" ? (
              <div>
                <dt className="label">Entries close</dt>
                <dd>
                  {fmtDateTime(round.closesAt)} · <Countdown target={round.closesAt} now={now} title={`${fmtDateTime(round.closesAt)} IST`} />
                </dd>
                <dd className="mt-1 text-xs text-muted">The seed stays sealed until then. Asking early gives no advantage: every entry gets the same kind of random number.</dd>
              </div>
            ) : (
              <>
                <div>
                  <dt className="label">Revealed seed (drawn {fmtDateTime(round.drawnAt)})</dt>
                  <dd>{round.seed ? <CopyHash value={round.seed} label="seed" /> : "—"}</dd>
                </div>
                {log?.early && (
                  <dd className="text-xs text-saffron">Drawn early by the owner using the demo-mode shortcut (closing time was {fmtDateTime(round.closesAt)}).</dd>
                )}
              </>
            )}
          </dl>
          {round.status === "open" && manage && demoMode() && (
            <ActionForm action={runDrawNowAction} className="mt-4 space-y-2 border-t border-line pt-4">
              <input type="hidden" name="roundId" value={round.id} />
              <Submit>Run draw now (demo)</Submit>
              <p className="text-xs text-muted">Demo mode only. Normally the draw runs automatically when entries close.</p>
            </ActionForm>
          )}
        </Section>

        <Section title="How the draw works">
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>
              Each entry&apos;s <strong>weight</strong> comes from its published priority score, which already includes{" "}
              <abbr title={`+${CREDIT_POINTS} priority per credit, up to ${MAX_CREDITS} credits. Earned by missing out in an earlier draw on this resource; used up when you win.`}>fairness credits</abbr>:{" "}
              <code className="font-mono text-xs">{WEIGHT_FORMULA}</code>.
            </li>
            <li>
              Each entry gets a random number: <code className="font-mono text-xs">{U_FORMULA}</code>.
            </li>
            <li>
              Its <strong>key</strong> is <code className="font-mono text-xs">{KEY_FORMULA}</code>. Sorting by key, highest first, is a{" "}
              <abbr title="Efraimidis–Spirakis (2006) weighted random sampling: an entry with weight w comes first with probability w ÷ (sum of all weights).">weighted shuffle</abbr>
              : double the weight, double the chance of going first. Nobody is ever ruled out.
            </li>
            <li>
              In that order, each entry gets its slot unless it overlaps a slot already given out, clashes with an approved booking, or would push that person past the{" "}
              {resource.weeklyHourCap} h fair-share cap.
            </li>
            <li>Winners wait for the owner to confirm. Everyone else joins the waiting list in draw order and earns +1 fairness credit.</li>
          </ol>
        </Section>
      </div>

      {round.status === "open" ? (
        <Section title={`Entries so far (${live.length})`}>
          {live.length === 0 ? (
            <Empty>No entries yet. Requests for {day} made before {fmtDateTime(round.closesAt)} join this draw.</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted"><th className="py-1">Entrant</th><th>Slot</th><th>Priority score</th><th>Weight</th><th>Chance of going first</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {live.map((b) => {
                  const total = live.reduce((s, x) => s + weightFromScore(x.priorityScore), 0);
                  const w = weightFromScore(b.priorityScore);
                  return (
                    <tr key={b.id} className={mine.has(b.id) ? "bg-thread-soft/40 font-medium" : ""}>
                      <td className="py-1.5">Entrant {personOf.get(b.userId)}{mine.has(b.id) ? " (you)" : ""}</td>
                      <td>{fmtTime(b.start)}–{fmtTime(b.end)}</td>
                      <td className="font-mono">{b.priorityScore}</td>
                      <td className="font-mono">{w.toFixed(1)}</td>
                      <td className="font-mono">{((w / total) * 100).toFixed(0)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-xs text-muted">Names are never shown. “Chance of going first” ignores overlaps: entries for different times can all win.</p>
        </Section>
      ) : log ? (
        <>
          {[...mine].length > 0 && (
            <Section title="Why did I (not) get it?">
              <ul className="space-y-2 text-sm">
                {log.entries
                  .filter((e) => mine.has(e.bookingId))
                  .map((e) => {
                    const beat = e.beatenBy ? log.entries.find((x) => x.rank === e.beatenBy) : null;
                    const over = log.overrides.find((o) => o.bookingId === e.bookingId);
                    return (
                      <li key={e.bookingId} className="rounded-lg border border-line bg-paper p-3">
                        <p className="font-medium">
                          Your {fmtTime(e.start)}–{fmtTime(e.end)} entry: drawn {e.rank} of {log.entries.length}, {e.outcome === "won" ? "won" : "not drawn"}.
                        </p>
                        <p className="text-muted">
                          Weight {e.weight.toFixed(1)} (score {e.score}) → key {e.key.toFixed(4)}.{" "}
                          {e.outcome === "won"
                            ? "Your slot was still free when your turn came."
                            : e.outcome === "overlap" && beat
                              ? `The entry drawn ${beat.rank} (key ${beat.key.toFixed(4)}) had already taken ${fmtTime(beat.start)}–${fmtTime(beat.end)}, which overlaps yours.`
                              : e.outcome === "cap"
                                ? "Winning this would have taken you past the fair-share cap."
                                : "Your time clashes with a booking approved before the draw."}{" "}
                          {e.outcome !== "won" && "You earned +1 fairness credit, which raises your weight next time."}
                        </p>
                        {over && <p className="mt-1 text-saffron">The owner overrode this win: “{over.reason}”. You received a fairness credit back.</p>}
                        <Link href={`/bookings/${e.bookingId}`} className="mt-1 inline-block text-thread hover:underline">Open your booking →</Link>
                      </li>
                    );
                  })}
              </ul>
            </Section>
          )}

          <Section title={`Published results (${log.entries.length} entries)`} aside={<span className="text-xs text-muted">Highest key is drawn first</span>}>
            {log.entries.length === 0 ? (
              <Empty>Nobody entered this round.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="py-1">Order</th><th>Entrant</th><th>Slot</th><th><abbr title="Priority score at entry time, including fairness credits">Score</abbr></th><th>Weight w</th><th><abbr title="Random number from HMAC-SHA256(seed, booking id)">u</abbr></th><th>Key u^(1/w)</th><th>Outcome</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {log.entries.map((e) => {
                      const over = log.overrides.find((o) => o.bookingId === e.bookingId);
                      const promoted = log.overrides.some((o) => o.promoted.includes(e.bookingId));
                      return (
                        <tr key={e.bookingId} className={mine.has(e.bookingId) ? "bg-thread-soft/40 font-medium" : ""}>
                          <td className="py-1.5 font-mono">{e.rank}</td>
                          <td>Entrant {e.person}{mine.has(e.bookingId) ? " (you)" : ""}</td>
                          <td className="whitespace-nowrap">{fmtTime(e.start)}–{fmtTime(e.end)}</td>
                          <td className="font-mono">{e.score}</td>
                          <td className="font-mono">{e.weight.toFixed(1)}</td>
                          <td className="font-mono" title={String(e.u)}>{e.u.toFixed(4)}</td>
                          <td className="font-mono" title={String(e.key)}>{e.key.toFixed(4)}</td>
                          <td>
                            <span className={e.outcome === "won" ? "text-teal" : "text-muted"}>
                              {e.outcome === "won" ? "✓ Won" : OUTCOME_LABEL[e.outcome]}
                              {e.outcome === "overlap" && e.beatenBy ? ` (by #${e.beatenBy})` : ""}
                            </span>
                            {over && <span className="block text-xs text-saffron">Overridden by owner</span>}
                            {promoted && <span className="block text-xs text-teal">Moved up after an override</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-3 grid gap-3 text-xs text-muted sm:grid-cols-2">
              <p>
                <strong>Fair-share room at draw time:</strong>{" "}
                {log.people.map((p) => `Entrant ${p.person}: ${p.capHours.toFixed(1)} h`).join(" · ") || "—"}
              </p>
              <p>
                <strong>Already-approved times that day:</strong>{" "}
                {log.blocked.length ? log.blocked.map((b) => `${fmtTime(b.start)}–${fmtTime(b.end)}`).join(", ") : "none"}
              </p>
            </div>
            {log.overrides.length > 0 && (
              <div className="mt-3">
                <h3 className="label">Human overrides after the draw</h3>
                <ul className="list-disc pl-5 text-sm">
                  {log.overrides.map((o) => (
                    <li key={o.bookingId}>
                      {fmtDateTime(o.at)}: entry #{log.entries.find((e) => e.bookingId === o.bookingId)?.rank} overridden — “{o.reason}”.{" "}
                      {o.promoted.length ? `${o.promoted.length} next-in-order entr${o.promoted.length === 1 ? "y" : "ies"} moved up.` : "Nobody else could use the slot."}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted">Overrides are human decisions and are listed here; they do not change the verifiable draw above.</p>
              </div>
            )}
          </Section>

          <Section title="Check it yourself">
            {round.seed && <VerifyInBrowser log={log} seed={round.seed} />}
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-thread">Check the commitment from a terminal</summary>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-paper p-3 font-mono text-xs">{`echo -n ${round.seed} | xxd -r -p | sha256sum\n# expect ${round.seedCommitment}`}</pre>
            </details>
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-thread">Raw draw log (JSON)</summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-paper p-3 font-mono text-[11px]">{JSON.stringify({ ...log, seed: round.seed }, null, 2)}</pre>
            </details>
          </Section>
        </>
      ) : (
        <Notice tone="warn">This round is marked drawn but has no results recorded.</Notice>
      )}
      <p className="text-xs text-muted">
        Booking ids are part of the published log because the random numbers are derived from them; they reveal nothing on their own, since booking pages are visible only to the borrower and staff.{" "}
        <Link href="/policy#rounds" className="text-thread hover:underline">Read the full policy</Link>.
      </p>
    </div>
  );
}
