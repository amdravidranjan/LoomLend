import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/time";
import { sweep } from "@/lib/workflow";
import { markAllReadAction } from "@/app/actions";
import { Empty, PageHeader } from "@/components/ui";

const ICON: Record<string, string> = {
  approved: "✅", rejected: "⛔", waitlisted: "⏳", promoted: "⬆️", submitted: "📨", review: "📝", reminder: "⏰",
  overdue: "🚨", cancelled: "✖️", checked_out: "📦", returned: "↩️", closed: "🧵", incident: "⚠️", strike: "🟥", no_show: "👻", info: "ℹ️",
};

export default async function NotificationsPage() {
  const user = await requireUser();
  await sweep();
  const items = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, user.id)).orderBy(desc(schema.notifications.createdAt)).limit(100);
  return (
    <div>
      <PageHeader kicker="Inbox" title="Notifications">
        <form action={markAllReadAction}>
          <button className="btn-ghost">Mark all read</button>
        </form>
      </PageHeader>
      {items.length === 0 ? (
        <Empty>No notifications yet.</Empty>
      ) : (
        <ul className="card divide-y divide-line">
          {items.map((n) => (
            <li key={n.id}>
              <Link href={n.link ?? "#"} className={`flex gap-3 p-4 hover:bg-paper ${n.read ? "opacity-70" : ""}`}>
                <span aria-hidden className="text-xl">{ICON[n.kind] ?? "🔔"}</span>
                <span className="flex-1">
                  <span className="block font-medium">{!n.read && <span className="sr-only">Unread: </span>}{n.title}</span>
                  <span className="block text-sm text-ink/80">{n.body}</span>
                  <span className="text-xs text-muted">{fmtDateTime(n.createdAt)}</span>
                </span>
                {!n.read && <span className="mt-2 size-2 rounded-full bg-saffron" aria-hidden />}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-muted">Reminders go out 24 h before a slot; overdue alerts go to both borrower and owner.</p>
    </div>
  );
}
