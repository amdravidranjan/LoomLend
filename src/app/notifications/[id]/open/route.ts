import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";

/** Opening a notification marks it read and follows its link (same-site paths only). */
export async function GET(request: Request, ctx: RouteContext<"/notifications/[id]/open">) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return Response.redirect(new URL("/login?next=/notifications", request.url), 303);
  const n = await db.query.notifications.findFirst({ where: and(eq(schema.notifications.id, id), eq(schema.notifications.userId, user.id)) });
  if (!n) return Response.redirect(new URL("/notifications", request.url), 303);
  if (!n.read) await db.update(schema.notifications).set({ read: true }).where(eq(schema.notifications.id, n.id));
  const to = n.link && n.link.startsWith("/") && !n.link.startsWith("//") ? n.link : "/notifications";
  return Response.redirect(new URL(to, request.url), 303);
}
