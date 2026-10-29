import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { desc, eq, and, inArray } from "drizzle-orm";
import QRCode from "qrcode";
import { db, schema } from "@/db";
import { canManageResource, requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/time";
import { ensureQrSecret, tagPath } from "@/lib/handover";
import { demoMode } from "@/lib/workflow";
import { manualTagCode } from "@/lib/handover-rules";
import { rotateTagAction } from "@/app/actions-handover";
import { ActionForm, Submit } from "@/components/forms";
import { Logo } from "@/components/logo";
import { PrintButton } from "@/components/handover-print";
import { Notice, Section } from "@/components/ui";

export const metadata: Metadata = { title: "QR tag · LoomLend" };

/** Absolute origin for the URL inside the QR, so a phone's native camera app opens it directly. */
async function origin() {
  const configured = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function TagPage({ params }: PageProps<"/resources/[id]/tag">) {
  const user = await requireUser();
  const { id } = await params;
  const r = await db.query.resources.findFirst({ where: eq(schema.resources.id, id) });
  if (!r) notFound();
  if (!canManageResource(user, r)) notFound(); // the secret is only for the people who stick the tag on

  const secret = await ensureQrSecret(r);
  const url = `${await origin()}${tagPath(r.id, secret)}`;
  const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#1f1d2bff", light: "#ffffffff" } });
  const manual = manualTagCode(r.id, secret);
  const history = await db
    .select()
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.entityId, r.id), inArray(schema.auditLog.action, ["resource.tag_rotated"])))
    .orderBy(desc(schema.auditLog.seq))
    .limit(1);

  return (
    <div className="space-y-6">
      {/* Print only the tag, sized for an A6 sheet or a 100×150 mm label. */}
      <style>{`
        @media print {
          @page { size: A6 portrait; margin: 6mm; }
          body * { visibility: hidden !important; }
          .ll-tag, .ll-tag * { visibility: visible !important; }
          .ll-tag { position: absolute; left: 0; top: 0; width: 100%; border: none !important; box-shadow: none !important; }
          header, nav, footer { display: none !important; }
        }
      `}</style>

      <div>
        <p className="text-sm text-muted">
          <Link href={`/resources/${r.id}`} className="hover:underline">← {r.name}</Link>
        </p>
        <h1 className="h-display mt-1 text-3xl font-semibold tracking-tight">QR tag</h1>
        <p className="text-sm text-muted">Print it and stick it on the item (or beside the door for a room). Borrowers scan it to prove they are at the item when they check in and return.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
        <article
          className="ll-tag mx-auto w-full max-w-[105mm] rounded-2xl border-2 border-ink bg-white p-5 text-ink"
          aria-label={`Printable tag for ${r.name}`}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <Logo size={26} />
              <span className="h-display text-lg font-semibold">LoomLend</span>
            </span>
            <span className="text-[10px] font-semibold tracking-widest text-muted uppercase">Shared item</span>
          </div>
          <div className="mx-auto my-3 w-full max-w-[72mm] [&>svg]:h-auto [&>svg]:w-full" role="img" aria-label="QR code" dangerouslySetInnerHTML={{ __html: svg }} />
          <p className="text-center text-lg leading-tight font-semibold">{r.emoji} {r.name}</p>
          <p className="text-center text-sm text-muted">{r.location}</p>
          <p className="mt-3 rounded-lg bg-ink py-2 text-center text-sm font-semibold text-white">Scan to check in or return</p>
          <p className="mt-2 text-center text-[11px] text-muted">
            Can&apos;t scan? Open LoomLend → Scan and enter <span className="font-mono font-semibold tracking-wider text-ink">{manual}</span>
          </p>
          {r.supervisionRequired && <p className="mt-1 text-center text-[11px] font-semibold text-saffron">Supervised: staff must co-sign every hand-over.</p>}
        </article>

        <div className="space-y-6">
          <Section title="Print">
            <div className="flex flex-wrap gap-2">
              <PrintButton />
              {demoMode() && (
                <Link href={tagPath(r.id, secret)} className="btn-ghost min-h-11 border-dashed border-saffron">
                  Open what a phone opens (demo)
                </Link>
              )}
            </div>
            <p className="mt-2 text-xs text-muted">Sized for A6 or a 100 × 150 mm label. Laminate it or cover with clear tape. The QR opens <span className="font-mono break-all">{url.replace(/k=.*/, "k=…")}</span>.</p>
          </Section>
          <Section title="Replace the tag">
            <p className="mb-3 text-sm">If a tag is photographed, copied or lost, rotate it. The old printed tag stops working immediately and the change is logged.</p>
            {history[0] && <p className="mb-3 text-xs text-muted">Last replaced {fmtDateTime(history[0].createdAt)}.</p>}
            <ActionForm action={rotateTagAction}>
              <input type="hidden" name="resourceId" value={r.id} />
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" name="confirm" className="size-4 accent-rose" /> I will print and stick the new tag now
              </label>
              <Submit className="btn-danger min-h-11">Rotate tag</Submit>
            </ActionForm>
          </Section>
          <Notice>Keep this page to yourself: anyone with the tag link can prove presence at this item. Members only ever see the physical tag.</Notice>
        </div>
      </div>
    </div>
  );
}
