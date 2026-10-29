import { desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { bookingRef } from "@/lib/workflow";
import { CATEGORIES } from "@/lib/catalog";

/**
 * Read-only data for the command palette: listed resources (public, like Discover) and, when
 * signed in, the person's own recent bookings. Nothing about other people is returned.
 */
export async function GET() {
  const user = await getCurrentUser();
  const resources = await db
    .select({
      id: schema.resources.id,
      name: schema.resources.name,
      emoji: schema.resources.emoji,
      location: schema.resources.location,
      category: schema.resources.category,
      department: schema.resources.department,
      tags: schema.resources.tags,
      status: schema.resources.status,
    })
    .from(schema.resources)
    .where(inArray(schema.resources.status, ["active", "maintenance"]));

  const bookings = user
    ? await db
        .select({ id: schema.bookings.id, status: schema.bookings.status, start: schema.bookings.start, resource: schema.resources.name, emoji: schema.resources.emoji })
        .from(schema.bookings)
        .innerJoin(schema.resources, eq(schema.resources.id, schema.bookings.resourceId))
        .where(eq(schema.bookings.userId, user.id))
        .orderBy(desc(schema.bookings.start))
        .limit(12)
    : [];

  return Response.json(
    {
      resources: resources.map((r) => ({ ...r, category: CATEGORIES[r.category] })),
      bookings: bookings.map((b) => ({ ...b, ref: bookingRef(b.id) })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
