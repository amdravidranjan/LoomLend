import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, gt, inArray, lt, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { canManageResource, getCurrentUser } from "@/lib/auth";
import { AFFILIATIONS, CATEGORIES, CERTS, PURPOSES } from "@/lib/catalog";
import { parseList, overlaps } from "@/lib/rules";
import { eligibilityFor, demoMode, sweep } from "@/lib/workflow";
import { awaitingConfirmation, getCredits, parseLog, roundPreview, roundsForResource } from "@/lib/allocation";
import { CREDIT_POINTS, MAX_CREDITS } from "@/lib/lottery";
import { DAY, DAY_NAMES, HOUR, campusDayAt, campusParts, currentTime, fmtDateTime, fmtDay, fmtRange, fmtTime, parseCampusLocal, toCampusLocalInput } from "@/lib/time";
import { requestBookingAction, setResourceStatusAction } from "@/app/actions";
import { confirmWinnersAction, overrideWinnerAction, runDrawNowAction, setAllocationModeAction } from "@/app/actions-allocation";
import { ActionForm, Submit } from "@/components/forms";
import { Badge, Checks, Notice, PageHeader, Pill, Section } from "@/components/ui";
import { Timeline } from "@/components/timeline";
import { Countdown } from "@/app/fairness/_components/countdown";
import { CopyHash } from "@/app/fairness/_components/copy-hash";

const PURPOSE_KEYS = Object.keys(PURPOSES) as (keyof typeof PURPOSES)[];

function suggestSlot(openHour: number, closeHour: number, days: number[], now: number) {
  for (let i = 0; i < 14; i++) {
    const t = now + i * DAY;
    if (!days.includes(campusParts(t).weekday)) continue;
    let start = campusDayAt(t, openHour);
    if (start < now) start = Math.ceil(now / HOUR) * HOUR;
    if (start + HOUR <= campusDayAt(t, closeHour)) return { start, end: start + HOUR };
  }
  return { start: campusDayAt(now + DAY, openHour), end: campusDayAt(now + DAY, openHour) + HOUR };
}

export async function generateMetadata({ params }: PageProps<"/resources/[id]">) {
  const { id } = await params;
  const r = await db.query.resources.findFirst({ where: eq(schema.resources.id, id), columns: { name: true } });
  return { title: r ? `${r.name} · LoomLend` : "Not found · LoomLend" };
}

export default async function ResourcePage({ params, searchParams }: PageProps<"/resources/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  await sweep(); // draws any round whose entries have closed
  const r = await db.query.resources.findFirst({ where: eq(schema.resources.id, id) });
  if (!r) notFound();
  const user = await getCurrentUser();
  const owner = await db.query.users.findFirst({ where: eq(schema.users.id, r.ownerId) });
  const now = currentTime();
  const days = parseList<number>(r.openDays);
  const certs = parseList(r.requiredCerts);

  // Slot the user is considering (from the "check" step), else a suggestion.
  const date = typeof sp.date === "string" ? sp.date : "";
  const from = typeof sp.from === "string" ? sp.from : "";
  const to = typeof sp.to === "string" ? sp.to : "";
  const chosen = date && from && to ? { start: parseCampusLocal(`${date}T${from}`), end: parseCampusLocal(`${date}T${to}`) } : null;
  const suggestion = suggestSlot(r.openHour, r.closeHour, days, now);
  const slot = chosen?.start && chosen.end ? { start: chosen.start, end: chosen.end } : null;
  const formDate = slot ? date : toCampusLocalInput(suggestion.start).slice(0, 10);
  const formFrom = slot ? from : toCampusLocalInput(suggestion.start).slice(11);
  const formTo = slot ? to : toCampusLocalInput(suggestion.end).slice(11);
  // Prefill from links such as the booking assistant's: ?purpose=…&purposeType=coursework
  const prefillPurpose = typeof sp.purpose === "string" ? sp.purpose.slice(0, 500) : "";
  const prefillType = typeof sp.purposeType === "string" && (PURPOSE_KEYS as string[]).includes(sp.purposeType) ? sp.purposeType : "coursework";

  const horizonEnd = now + 7 * DAY;
  const booked = await db
    .select()
    .from(schema.bookings)
    .where(and(eq(schema.bookings.resourceId, r.id), inArray(schema.bookings.status, ["approved", "checked_out", "returned", "pending", "waitlisted"]), gt(schema.bookings.end, now - DAY), lt(schema.bookings.start, horizonEnd + DAY)));

  const elig = user ? await eligibilityFor(user, r, slot ?? undefined) : null;
  const holders = slot ? booked.filter((b) => ["approved", "checked_out", "returned"].includes(b.status) && overlaps(b, slot)) : [];
  const rivals = slot ? booked.filter((b) => ["pending", "waitlisted"].includes(b.status) && overlaps(b, slot) && b.userId !== user?.id) : [];
  const manage = user ? canManageResource(user, r) : false;

  // Fair-draw rounds
  const rounds = r.allocationMode === "rounds" || manage ? await roundsForResource(r.id) : [];
  const openRounds = rounds.filter((x) => x.status === "open").sort((a, b) => a.closesAt - b.closesAt);
  const drawnRounds = rounds.filter((x) => x.status === "drawn").slice(0, 3);
  const entryCounts = new Map<string, number>();
  for (const o of openRounds) {
    entryCounts.set(o.id, (await db.select({ id: schema.bookings.id }).from(schema.bookings).where(and(eq(schema.bookings.roundId, o.id), eq(schema.bookings.status, "pending")))).length);
  }
  const awaiting = manage ? await awaitingConfirmation(r.id) : [];
  const winnerNames = awaiting.length
    ? await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, awaiting.flatMap((a) => a.winners.map((w) => w.userId))))
    : [];
  const myCredits = user && r.allocationMode === "rounds" ? await getCredits(user.id, r.id) : 0;
  const preview = slot && holders.length === 0 ? await roundPreview(r, slot.start, now) : null;
  const joinsDraw = preview?.kind === "join";

  const history = manage
    ? await db
        .select()
        .from(schema.auditLog)
        .where(or(eq(schema.auditLog.entityId, r.id), inArray(schema.auditLog.bookingId, booked.map((b) => b.id).concat("none"))))
        .orderBy(desc(schema.auditLog.seq))
        .limit(12)
    : [];

  // 7-day availability strip
  const strip = Array.from({ length: 7 }, (_, i) => {
    const dayStart = campusDayAt(now + i * DAY, 0);
    const open = days.includes(campusParts(dayStart + 12 * HOUR).weekday);
    const items = booked.filter((b) => b.start >= dayStart && b.start < dayStart + DAY).sort((a, b) => a.start - b.start);
    return { dayStart, open, items };
  });

  return (
    <div className="space-y-6">
      {sp.listed && <Notice tone="ok">Your resource is listed. Members can discover it now.</Notice>}
      <div className="flex flex-wrap items-start gap-4">
        <span className="text-5xl" aria-hidden>{r.emoji}</span>
        <div className="min-w-0 flex-1">
          <PageHeader kicker={`${CATEGORIES[r.category]} · ${r.department}`} title={r.name} />
          <p className="-mt-4 text-muted">
            📍 {r.location} · Owner: {owner?.name}
          </p>
        </div>
        {r.status !== "active" && <Badge status={r.status} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Section title="About">
            <p className="text-sm text-ink/85">{r.description}</p>
            <h3 className="label mt-4">Usage rules</h3>
            <p className="text-sm text-ink/85">{r.usageRules}</p>
          </Section>

          <Section title="Access conditions">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div><dt className="label">Open</dt><dd>{days.map((d) => DAY_NAMES[d]).join(", ")} · {r.openHour}:00–{r.closeHour}:00</dd></div>
              <div><dt className="label">Per booking</dt><dd>Up to {r.maxHours} h, same day</dd></div>
              <div><dt className="label">Fair-share cap</dt><dd>{r.weeklyHourCap} h per person within any 7 days</dd></div>
              <div><dt className="label">Who can book</dt><dd>{parseList(r.allowedAffiliations).map((a) => AFFILIATIONS[a]).join(", ")}</dd></div>
              <div><dt className="label">Training</dt><dd>{certs.length ? certs.map((c) => CERTS[c]?.label).join(", ") : "None required"}</dd></div>
              <div><dt className="label">Hand-over</dt><dd>{r.supervisionRequired ? "Supervised: staff record check-in with you" : "Self check-in with condition record"}</dd></div>
              <div><dt className="label">Deposit</dt><dd>{r.depositRequired ? `₹${r.depositRequired}, recorded against your account and released on clean return` : "None"}</dd></div>
              <div>
                <dt className="label">Approval</dt>
                <dd>
                  {r.allocationMode === "rounds"
                    ? `Fair draw: requests for a day are pooled until ${r.roundLeadHours} h before it starts, then allocated by a verifiable weighted lottery; the owner confirms winners`
                    : r.autoApprove
                      ? "Instant when eligible and uncontested"
                      : "Reviewed by the owner"}
                </dd>
              </div>
            </dl>
          </Section>

          <Section title="Next 7 days">
            <ol className="grid gap-2 sm:grid-cols-7">
              {strip.map((d) => (
                <li key={d.dayStart} className={`rounded-lg border p-2 text-xs ${d.open ? "border-line bg-card" : "border-dashed border-line bg-paper text-muted"}`}>
                  <p className="font-semibold">{fmtDay(d.dayStart + 12 * HOUR)}</p>
                  {!d.open ? (
                    <p>Closed</p>
                  ) : d.items.length === 0 ? (
                    <p className="text-teal">Free</p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {d.items.map((b) => (
                        <li
                          key={b.id}
                          className={`rounded px-1 py-0.5 ${["approved", "checked_out", "returned"].includes(b.status) ? "bg-saffron-soft text-saffron" : "bg-thread-soft text-thread"}`}
                          title={b.status}
                        >
                          {fmtTime(b.start)}–{fmtTime(b.end)}
                          <span className="block opacity-80">{["approved", "checked_out", "returned"].includes(b.status) ? "Booked" : b.status === "waitlisted" ? "Waitlist" : "Requested"}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-muted">Who booked is never shown to other members.</p>
          </Section>

          {manage && (
            <Section
              title="Owner controls"
              aside={
                <Link href={`/resources/${r.id}/tag`} className="btn-ghost px-3 py-1.5 text-sm">
                  Print QR tag
                </Link>
              }
            >
              <ActionForm action={setResourceStatusAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="resourceId" value={r.id} />
                <div>
                  <label className="label" htmlFor="status">Status</label>
                  <select id="status" name="status" defaultValue={r.status} className="input">
                    <option value="active">Active</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="retired">Retired</option>
                  </select>
                </div>
                <div className="min-w-48 flex-1">
                  <label className="label" htmlFor="note">Note to affected borrowers</label>
                  <input id="note" name="note" className="input" placeholder="e.g. Gimbal repair, back Friday" />
                </div>
                <Submit className="btn-ghost">Update</Submit>
              </ActionForm>
              <ActionForm action={setAllocationModeAction} className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4">
                <input type="hidden" name="resourceId" value={r.id} />
                <div>
                  <label className="label" htmlFor="allocationMode">How requests are decided</label>
                  <select id="allocationMode" name="allocationMode" defaultValue={r.allocationMode} className="input">
                    <option value="review">Owner review, one by one</option>
                    <option value="rounds">Fair-draw rounds (weighted lottery)</option>
                  </select>
                </div>
                <div className="w-36">
                  <label className="label" htmlFor="roundLeadHours">Entries close (h before day)</label>
                  <input id="roundLeadHours" name="roundLeadHours" type="number" min={1} max={168} defaultValue={r.roundLeadHours} className="input" />
                </div>
                <Submit className="btn-ghost">Save</Submit>
              </ActionForm>
              <h3 className="label mt-5">Recent activity</h3>
              <Timeline entries={history} />
            </Section>
          )}
        </div>

        <div className="space-y-6">
          {(r.allocationMode === "rounds" || openRounds.length > 0 || awaiting.length > 0) && (
            <div id="draw">
              <Section title="Fair draw" aside={<Link href="/policy#rounds" className="text-xs text-thread">How it works</Link>}>
                <p className="text-sm text-ink/80">
                  This resource is in high demand, so requests for each day are pooled and drawn by a{" "}
                  <abbr title="Each request's chance grows with its published priority score. Nobody is ruled out, and asking first gives no advantage.">weighted lottery</abbr>{" "}
                  {r.roundLeadHours} h before the day starts. The random seed&apos;s fingerprint is published before the draw, so nobody can rig it.
                </p>
                {user && r.allocationMode === "rounds" && (
                  <p className="mt-2 text-sm">
                    Your fairness credits here: <strong>{myCredits}</strong> of {MAX_CREDITS}
                    {myCredits ? ` (+${myCredits * CREDIT_POINTS} priority on your next entry)` : " — you earn one each time you miss out in a draw"}.
                  </p>
                )}
                {openRounds.length === 0 ? (
                  <p className="mt-3 rounded-lg border border-dashed border-line px-3 py-3 text-sm text-muted">
                    No draw is open right now. The first request for a future day opens one and publishes its seed fingerprint.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {openRounds.map((o) => (
                      <li key={o.id} className="rounded-lg border border-line bg-paper p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">Draw for {fmtDay(o.dayStart + 12 * HOUR)}</span>
                          <Pill tone="info">{entryCounts.get(o.id) ?? 0} entr{entryCounts.get(o.id) === 1 ? "y" : "ies"}</Pill>
                        </div>
                        <p className="mt-1 text-muted">
                          Closes in <Countdown target={o.closesAt} now={now} title={`${fmtDateTime(o.closesAt)} IST`} /> ({fmtDateTime(o.closesAt)})
                        </p>
                        <p className="mt-1">
                          <span className="text-xs text-muted" title="SHA-256 fingerprint of the secret seed, fixed before anyone entered">Seed commitment </span>
                          <CopyHash value={o.seedCommitment} label="seed commitment" chars={10} />
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <Link href={`/fairness/rounds/${o.id}`} className="text-thread hover:underline">Entries &amp; verification →</Link>
                          {manage && demoMode() && (
                            <ActionForm action={runDrawNowAction} className="flex flex-col gap-1">
                              <input type="hidden" name="roundId" value={o.id} />
                              <Submit className="btn-ghost">Run draw now (demo)</Submit>
                            </ActionForm>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {manage &&
                  awaiting.map(({ round: ar, winners }) => {
                    const log = parseLog(ar);
                    const rankOf = new Map(log?.entries.map((e) => [e.bookingId, e.rank]) ?? []);
                    return (
                      <div key={ar.id} className="mt-4 rounded-lg border border-teal-200 bg-teal-soft/40 p-3 text-sm">
                        <p className="font-medium">Winners for {fmtDay(ar.dayStart + 12 * HOUR)} awaiting your confirmation</p>
                        <ul className="mt-2 space-y-2">
                          {[...winners]
                            .sort((a, b) => (rankOf.get(a.id) ?? 99) - (rankOf.get(b.id) ?? 99))
                            .map((w) => (
                              <li key={w.id} className="rounded-md border border-line bg-card p-2">
                                <p>
                                  <span className="font-mono text-xs text-muted">#{rankOf.get(w.id) ?? "–"}</span> {winnerNames.find((n) => n.id === w.userId)?.name} · {fmtTime(w.start)}–{fmtTime(w.end)} ·{" "}
                                  <Link href={`/bookings/${w.id}`} className="text-thread hover:underline">details</Link>
                                </p>
                                <details className="mt-1">
                                  <summary className="cursor-pointer text-xs text-muted">Override this winner…</summary>
                                  <ActionForm action={overrideWinnerAction} className="mt-2 space-y-2">
                                    <input type="hidden" name="bookingId" value={w.id} />
                                    <label className="label" htmlFor={`ov-${w.id}`}>Reason (shown publicly on the draw page)</label>
                                    <input id={`ov-${w.id}`} name="reason" required minLength={10} className="input" placeholder="e.g. Purpose involves PVC, which is banned on this machine" />
                                    <Submit className="btn-danger">Override and move the next entry up</Submit>
                                  </ActionForm>
                                </details>
                              </li>
                            ))}
                        </ul>
                        <ActionForm action={confirmWinnersAction} className="mt-3 space-y-2">
                          <input type="hidden" name="roundId" value={ar.id} />
                          <Submit className="btn-ok">Confirm winners</Submit>
                        </ActionForm>
                        <p className="mt-1 text-xs text-muted">Each winner is re-checked against the requirements when you confirm.</p>
                      </div>
                    );
                  })}

                {drawnRounds.length > 0 && (
                  <p className="mt-3 text-xs text-muted">
                    Recent draws:{" "}
                    {drawnRounds.map((d, i) => (
                      <span key={d.id}>
                        {i > 0 && " · "}
                        <Link href={`/fairness/rounds/${d.id}`} className="text-thread hover:underline">{fmtDay(d.dayStart + 12 * HOUR)}</Link>
                      </span>
                    ))}
                  </p>
                )}
              </Section>
            </div>
          )}
          <Section title={slot ? "Your slot" : "Check a slot"}>
            {!user ? (
              <p className="text-sm">
                <Link href="/login" className="text-thread underline">Sign in</Link> to check your eligibility and request this resource.
              </p>
            ) : (
              <>
                <form className="grid grid-cols-3 gap-2" action={`/resources/${r.id}`}>
                  {prefillPurpose && <input type="hidden" name="purpose" value={prefillPurpose} />}
                  {typeof sp.purposeType === "string" && <input type="hidden" name="purposeType" value={prefillType} />}
                  <div className="col-span-3">
                    <label className="label" htmlFor="date">Date</label>
                    <input id="date" type="date" name="date" defaultValue={formDate} required className="input" />
                  </div>
                  <div>
                    <label className="label" htmlFor="from">From</label>
                    <input id="from" type="time" name="from" step={1800} defaultValue={formFrom} required className="input" />
                  </div>
                  <div>
                    <label className="label" htmlFor="to">To</label>
                    <input id="to" type="time" name="to" step={1800} defaultValue={formTo} required className="input" />
                  </div>
                  <div className="flex items-end">
                    <button className="btn-ghost w-full">Check</button>
                  </div>
                </form>
                <p className="mt-2 text-xs text-muted">Times are campus time (IST).</p>
              </>
            )}

            {elig && (
              <div className="mt-4 space-y-3">
                <h3 className="label">{slot ? "Requirements for this slot" : "Your requirements"}</h3>
                <Checks checks={elig.checks} />
                {slot && holders.length > 0 && (
                  <Notice tone="warn">
                    This time overlaps an approved booking ({holders.map((h) => fmtRange(h.start, h.end)).join("; ")}). If you request it you go on the
                    waiting list and move up automatically if it frees.
                  </Notice>
                )}
                {preview?.kind === "join" && (
                  <Notice>
                    <strong>This day is allocated by a fair draw.</strong> Requests made before {fmtDateTime(preview.closesAt)} (
                    <Countdown target={preview.closesAt} now={now} title={`${fmtDateTime(preview.closesAt)} IST`} />) are pooled
                    {preview.entries ? ` (${preview.entries} so far)` : ""}, then drawn by weighted lottery. Your chance grows with your priority score and
                    fairness credits; asking first gives no advantage.{" "}
                    {preview.round && (
                      <Link href={`/fairness/rounds/${preview.round.id}`} className="underline">See the seed commitment</Link>
                    )}
                  </Notice>
                )}
                {preview && (preview.kind === "late" || preview.kind === "drawn") && (
                  <Notice tone="warn">
                    The draw for this day {preview.kind === "drawn" ? "has already run" : `closed at ${fmtDateTime(preview.closesAt)}`}. Late requests go to the owner
                    for review like normal requests, after the draw winners.
                  </Notice>
                )}
                {slot && holders.length === 0 && rivals.length > 0 && !joinsDraw && (
                  <Notice>
                    {rivals.length} other request{rivals.length > 1 ? "s" : ""} want an overlapping time. The owner sees everyone&apos;s priority score;
                    see the <Link href="/policy" className="underline">fair-use policy</Link>.
                  </Notice>
                )}
                {slot && holders.length === 0 && rivals.length === 0 && elig.eligible && <Notice tone="ok">Slot is free and you meet every requirement.</Notice>}
              </div>
            )}

            {user && slot && elig?.eligible && (
              <ActionForm action={requestBookingAction} className="mt-4 space-y-3 border-t border-line pt-4">
                <input type="hidden" name="resourceId" value={r.id} />
                <input type="hidden" name="start" value={`${date}T${from}`} />
                <input type="hidden" name="endTime" value={to} />
                <div>
                  <label className="label" htmlFor="purposeType">Purpose</label>
                  <select id="purposeType" name="purposeType" defaultValue={prefillType} className="input">
                    {Object.entries(PURPOSES).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="purpose">What will you do? (shared with the owner)</label>
                  <textarea id="purpose" name="purpose" required minLength={10} rows={3} defaultValue={prefillPurpose} className="input" placeholder="Course code or project, what you will make, materials you bring." />
                </div>
                <p className="text-xs text-muted">
                  By requesting you agree to the usage rules above. {r.depositRequired ? `A ₹${r.depositRequired} deposit is recorded against your account. ` : ""}
                  {r.supervisionRequired ? "Staff will be present at check-in." : ""}
                </p>
                <Submit>{holders.length ? "Join the waiting list" : joinsDraw ? "Enter the draw" : r.autoApprove && rivals.length === 0 && !r.supervisionRequired ? "Book now" : "Send request"}</Submit>
              </ActionForm>
            )}
            {demoMode() && user && <p className="mt-3 text-xs text-muted">Demo mode: once approved you can check in straight away, even for a future slot, so the whole journey can be tested in one sitting.</p>}
          </Section>
        </div>
      </div>
    </div>
  );
}
