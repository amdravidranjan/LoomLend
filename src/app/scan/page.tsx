import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { fmtRange } from "@/lib/time";
import { manualTagAction } from "@/app/actions-handover";
import { ActionForm, Submit } from "@/components/forms";
import { HandoverScanner } from "@/components/handover-scanner";
import { Badge, PageHeader, Section } from "@/components/ui";

export const metadata: Metadata = { title: "Scan a tag · LoomLend" };

export default async function ScanPage() {
  const user = await getCurrentUser();
  const active = user
    ? await db
        .select({ b: schema.bookings, name: schema.resources.name, emoji: schema.resources.emoji, location: schema.resources.location })
        .from(schema.bookings)
        .innerJoin(schema.resources, eq(schema.resources.id, schema.bookings.resourceId))
        .where(and(eq(schema.bookings.userId, user.id), inArray(schema.bookings.status, ["approved", "checked_out"])))
    : [];
  active.sort((x, y) => (x.b.status === y.b.status ? x.b.start - y.b.start : x.b.status === "checked_out" ? -1 : 1));

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader kicker="At the machine" title="Scan the item's tag" />
      <p className="-mt-4 text-sm text-muted">
        Every shared item has a LoomLend QR tag. Scanning it proves you are physically there, then lets you check in or return in one step. Your phone&apos;s normal camera app works too.
      </p>

      <HandoverScanner />

      <Section title="Can't scan?">
        <ActionForm action={manualTagAction}>
          <div>
            <label className="label" htmlFor="tagCode">Code printed under the QR</label>
            <input
              id="tagCode"
              name="tagCode"
              required
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="input min-h-12 font-mono text-lg tracking-widest uppercase"
              placeholder="ABCD-EFGH-JK23"
            />
          </div>
          <Submit className="btn-primary min-h-12 w-full">Open item</Submit>
          <p className="text-xs text-muted">Tag damaged or missing? Ask the staff member for a one-time code: you can enter it on your booking page.</p>
        </ActionForm>
      </Section>

      {user && active.length > 0 && (
        <Section title="Your active bookings">
          <ul className="space-y-2">
            {active.map(({ b, name, emoji, location }) => (
              <li key={b.id}>
                <Link href={`/bookings/${b.id}`} className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-line bg-white p-3 text-sm hover:border-thread">
                  <span>
                    <span className="font-medium">{emoji} {name}</span>
                    <span className="block text-xs text-muted">{fmtRange(b.start, b.end)} · {location}</span>
                  </span>
                  <Badge status={b.status} label={b.status === "approved" ? "Ready to check in" : "Return"} />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {!user && (
        <p className="text-center text-sm text-muted">
          You will be asked to <Link href="/login" className="text-thread underline">sign in</Link> after scanning.
        </p>
      )}
    </div>
  );
}
