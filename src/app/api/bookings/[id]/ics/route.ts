import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { bookingRef } from "@/lib/workflow";
import { STATUS_LABEL } from "@/lib/catalog";

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
/** RFC 5545 lines are folded at 75 octets. */
const fold = (line: string) => line.match(/.{1,73}/g)!.join("\r\n ");

/** "Add to calendar" for a booking. Only the person who booked it can download it. */
export async function GET(request: Request, ctx: RouteContext<"/api/bookings/[id]/ics">) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in to download this booking.", { status: 401 });
  const b = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, id) });
  if (!b || b.userId !== user.id) return new Response("Not found.", { status: 404 });
  const r = await db.query.resources.findFirst({ where: eq(schema.resources.id, b.resourceId) });
  if (!r) return new Response("Not found.", { status: 404 });

  const ref = bookingRef(b.id);
  const url = new URL(`/bookings/${b.id}`, request.url).toString();
  const status = b.status === "approved" || b.status === "checked_out" ? "CONFIRMED" : b.status === "cancelled" || b.status === "rejected" ? "CANCELLED" : "TENTATIVE";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LoomLend//Campus sharing//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${b.id}@loomlend`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(b.start)}`,
    `DTEND:${stamp(b.end)}`,
    `SUMMARY:${esc(`${r.name} (${ref})`)}`,
    `LOCATION:${esc(r.location)}`,
    `DESCRIPTION:${esc(`LoomLend booking ${ref} · ${STATUS_LABEL[b.status] ?? b.status}\nScan the item's QR tag at the door to check in.\nRules: ${r.usageRules}\n${url}`)}`,
    `URL:${url}`,
    `STATUS:${status}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT30M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(`${r.name} in 30 minutes`)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].map(fold);

  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${ref}.ics"`,
      "Cache-Control": "private, no-store",
    },
  });
}
