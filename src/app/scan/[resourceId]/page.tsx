import type { Metadata } from "next";
import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { canManageResource, getCurrentUser } from "@/lib/auth";
import { fmtDateTime, fmtRange, currentTime, relative } from "@/lib/time";
import { bookingRef, demoMode } from "@/lib/workflow";
import { activeBookingsOn, ensureQrSecret, scanTargetFor, tagSecretMatches } from "@/lib/handover";
import { photoRequired } from "@/lib/handover-rules";
import { loginAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { DemoAccounts } from "@/components/demo-accounts";
import { HandoverForm } from "@/components/handover-form";
import { Badge, Notice, Section } from "@/components/ui";

export const metadata: Metadata = { title: "Item hand-over · LoomLend" };

function Shell({ children, title, kicker }: { children: React.ReactNode; title: string; kicker?: string }) {
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        {kicker && <p className="text-xs font-semibold tracking-widest text-saffron uppercase">{kicker}</p>}
        <h1 className="h-display text-3xl font-semibold tracking-tight">{title}</h1>
      </div>
      {children}
    </div>
  );
}

function NextSteps({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-2 sm:flex-row">{children}</div>;
}

export default async function ScanResourcePage({ params, searchParams }: PageProps<"/scan/[resourceId]">) {
  const { resourceId } = await params;
  const sp = await searchParams;
  const k = typeof sp.k === "string" ? sp.k : "";
  const here = `/scan/${encodeURIComponent(resourceId)}?k=${encodeURIComponent(k)}`;

  const r = await db.query.resources.findFirst({ where: eq(schema.resources.id, resourceId) });
  if (!r) {
    return (
      <Shell title="Unknown tag" kicker="Scan">
        <Notice tone="error">This tag does not belong to any item on LoomLend. It may be from a retired item.</Notice>
        <NextSteps>
          <Link href="/scan" className="btn-primary min-h-12">Scan again</Link>
          <Link href="/resources" className="btn-ghost min-h-12">Browse items</Link>
        </NextSteps>
      </Shell>
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return (
      <Shell title={`${r.emoji} ${r.name}`} kicker="Sign in to continue">
        <Notice>Sign in and you will come straight back here to check in or return this item.</Notice>
        <Section title="Sign in">
          <ActionForm action={loginAction}>
            <input type="hidden" name="next" value={here} />
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" required className="input min-h-12" autoComplete="email" />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input id="password" name="password" type="password" required className="input min-h-12" autoComplete="current-password" />
            </div>
            <Submit className="btn-primary min-h-12 w-full">Sign in and continue</Submit>
          </ActionForm>
        </Section>
        <details className="card p-4">
          <summary className="cursor-pointer font-medium">Or use a demo person</summary>
          <div className="mt-3"><DemoAccounts next={here} /></div>
        </details>
      </Shell>
    );
  }

  await ensureQrSecret(r);
  const fresh = (await db.query.resources.findFirst({ where: eq(schema.resources.id, r.id) }))!;
  const staff = canManageResource(user, fresh);
  if (!tagSecretMatches(fresh, k)) {
    return (
      <Shell title={`${r.emoji} ${r.name}`} kicker="Tag not valid">
        <Notice tone="error">
          {k ? "This QR tag is no longer valid. The owner has replaced it, so an old printed tag will not work." : "This link is missing the tag's security code."}
        </Notice>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Scan the tag that is stuck on the item itself right now.</li>
          <li>Or ask the staff member for a one-time code and enter it on your booking page.</li>
          {staff && <li>You manage this item: print the current tag from the tag page.</li>}
        </ul>
        <NextSteps>
          <Link href="/scan" className="btn-primary min-h-12">Scan again</Link>
          {staff ? <Link href={`/resources/${r.id}/tag`} className="btn-ghost min-h-12">Print current tag</Link> : <Link href="/bookings" className="btn-ghost min-h-12">My bookings</Link>}
        </NextSteps>
      </Shell>
    );
  }

  const now = currentTime();
  const needPhoto = photoRequired(fresh);
  const header = (
    <div className="card flex items-start justify-between gap-3 p-4">
      <div>
        <p className="font-medium">{r.location}</p>
        <p className="text-xs text-muted">{r.supervisionRequired ? "Supervised item: staff co-sign every hand-over." : "Self-service hand-over with this tag."}</p>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-teal-soft px-2.5 py-1 text-xs font-semibold text-teal">✓ Tag verified</span>
    </div>
  );

  // Staff at the item: act on any booking in progress.
  if (staff) {
    const list = await activeBookingsOn(r.id);
    const borrowers = list.length
      ? await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, list.map((b) => b.userId)))
      : [];
    return (
      <Shell title={`${r.emoji} ${r.name}`} kicker="Staff at the item">
        {header}
        {list.length === 0 ? (
          <Notice>No bookings are waiting for check-in or return on this item.</Notice>
        ) : (
          <ul className="space-y-3">
            {list.map((b, i) => {
              const purpose = b.status === "approved" ? "check_out" : "return";
              const who = borrowers.find((u) => u.id === b.userId)?.name ?? "Borrower";
              return (
                <li key={b.id}>
                  <details className="card p-4" open={i === 0}>
                    <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2">
                      <span>
                        <span className="font-medium">{who}</span>
                        <span className="block text-xs text-muted">{bookingRef(b.id)} · {fmtRange(b.start, b.end)}</span>
                      </span>
                      <Badge status={b.status} label={purpose === "check_out" ? "Check in" : "Return"} />
                    </summary>
                    <div className="mt-3">
                      <HandoverForm
                        bookingId={b.id}
                        purpose={purpose}
                        methods={["staff_manual"]}
                        photoRequired={needPhoto}
                        defaultCondition={purpose === "return" ? (b.checkOutCondition ?? "good") : "good"}
                        submitLabel={purpose === "check_out" ? `Record check-in for ${who}` : `Record return from ${who}`}
                        intro="Inspect the item together with the borrower and record what you both see."
                      />
                      <p className="mt-2 text-xs text-muted">
                        Prefer the borrower to confirm on their phone? <Link className="text-thread underline" href={`/bookings/${b.id}`}>Give them a one-time code</Link>.
                      </p>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-sm"><Link className="text-thread underline" href={`/resources/${r.id}/tag`}>Tag &amp; printing</Link></p>
      </Shell>
    );
  }

  const target = await scanTargetFor(user, fresh, now);
  if (target.kind === "early") {
    const b = target.booking;
    return (
      <Shell title={`${r.emoji} ${r.name}`} kicker="Not yet">
        {header}
        <Notice tone="warn">
          Your slot is {fmtRange(b.start, b.end)} ({relative(b.start, now)}). Check-in opens 30 minutes before it starts ({fmtDateTime(b.start - 30 * 60_000)}).
        </Notice>
        <NextSteps>
          <Link href={`/bookings/${b.id}`} className="btn-primary min-h-12">Open my booking</Link>
        </NextSteps>
      </Shell>
    );
  }
  if (target.kind === "taken" || target.kind === "none") {
    return (
      <Shell title={`${r.emoji} ${r.name}`} kicker="No booking to hand over">
        {header}
        <Notice tone="warn">
          {target.kind === "taken"
            ? `This item is booked by someone else right now${target.until ? ` (until ${fmtDateTime(target.until)})` : ""}. Only they or staff can hand it over.`
            : "You don't have an approved booking for this item right now."}
        </Notice>
        <NextSteps>
          <Link href={`/resources/${r.id}`} className="btn-primary min-h-12">See availability and book</Link>
          <Link href="/bookings" className="btn-ghost min-h-12">My bookings</Link>
        </NextSteps>
      </Shell>
    );
  }

  const b = target.booking;
  const purpose = target.kind;
  const methods = (fresh.supervisionRequired ? ["staff_code"] : ["qr", "staff_code"]) as ("qr" | "staff_code")[];
  return (
    <Shell title={`${r.emoji} ${r.name}`} kicker={purpose === "check_out" ? "Check in" : "Return"}>
      {header}
      <p className="text-sm text-muted">
        Booking {bookingRef(b.id)} · {fmtRange(b.start, b.end)}
        {purpose === "return" && b.end < now ? <span className="font-medium text-rose"> · due {relative(b.end, now)}</span> : null}
      </p>
      {fresh.supervisionRequired && (
        <Notice>This item is supervised. Scanning found your booking; now ask the staff member to generate a one-time code and enter it below.</Notice>
      )}
      <section className="card p-4">
        <HandoverForm
          bookingId={b.id}
          purpose={purpose}
          methods={methods}
          qrSecret={k}
          photoRequired={needPhoto}
          defaultCondition={purpose === "return" ? (b.checkOutCondition ?? "good") : "good"}
          submitLabel={purpose === "check_out" ? "Check in now" : "Return it"}
          intro={
            purpose === "check_out"
              ? "Inspect it before you start and record what you see. This protects you if something was already wrong."
              : "Record the condition you are returning it in. Your pick-up photo is compared with this one."
          }
        />
      </section>
      {demoMode() && <p className="text-center text-xs text-muted">Demo mode: time windows are relaxed.</p>}
    </Shell>
  );
}
