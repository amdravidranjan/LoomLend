import "server-only";
import { inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { HOUR } from "@/lib/time";

/** Live, public numbers for the landing page and the Open Graph card. No personal data. */
export async function publicStats() {
  const resources = await db
    .select({ id: schema.resources.id, department: schema.resources.department, category: schema.resources.category })
    .from(schema.resources)
    .where(inArray(schema.resources.status, ["active", "maintenance"]));
  const used = await db
    .select({ userId: schema.bookings.userId, start: schema.bookings.start, end: schema.bookings.end, status: schema.bookings.status, reason: schema.bookings.decisionReason })
    .from(schema.bookings)
    .where(inArray(schema.bookings.status, ["checked_out", "returned", "closed"]));
  const real = used.filter((b) => !b.reason?.startsWith("No-show"));
  const hours = real.reduce((h, b) => h + (b.end - b.start) / HOUR, 0);
  return {
    resources: resources.length,
    departments: new Set(resources.map((r) => r.department)).size,
    hoursShared: Math.round(hours),
    peopleServed: new Set(real.map((b) => b.userId)).size,
    loans: real.length,
    inUse: used.filter((b) => b.status === "checked_out").length,
  };
}
