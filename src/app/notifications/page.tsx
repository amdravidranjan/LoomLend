import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { DAY, campusDayAt, currentTime, fmtDay, fmtTime } from "@/lib/time";
import { sweep } from "@/lib/workflow";
import { markAllReadAction } from "@/app/actions";
import { setReadAction } from "./actions";
import { PageHeader } from "@/components/ui";
import { Icon, type IconName } from "@/components/ds/icons";
import { EmptyState, LinkTabs, Tooltip } from "@/components/ds/primitives";
import { RelativeTime } from "@/components/ds/client";

export const metadata: Metadata = { title: "Notifications · LoomLend" };

const KIND: Record<string, { icon: IconName; tone: string }> = {
  approved: { icon: "check", tone: "bg-teal-soft text-teal" },
  rejected: { icon: "x", tone: "bg-rose-soft text-rose" },
  waitlisted: { icon: "hourglass", tone: "bg-thread-soft text-thread" },
  promoted: { icon: "arrowRight", tone: "bg-teal-soft text-teal" },
  submitted: { icon: "inbox", tone: "bg-thread-soft text-thread" },
  review: { icon: "layers", tone: "bg-amber-soft text-amber-ink" },
  reminder: { icon: "clock", tone: "bg-sky-soft text-sky" },
  overdue: { icon: "alert", tone: "bg-rose-soft text-rose" },
  cancelled: { icon: "x", tone: "bg-sunken text-muted" },
  checked_out: { icon: "box", tone: "bg-saffron-soft text-saffron" },
  returned: { icon: "undo", tone: "bg-sky-soft text-sky" },
  closed: { icon: "thread", tone: "bg-teal-soft text-teal" },
  incident: { icon: "flag", tone: "bg-rose-soft text-rose" },
  strike: { icon: "alert", tone: "bg-rose-soft text-rose" },
  no_show: { icon: "user", tone: "bg-amber-soft text-amber-ink" },
  info: { icon: "info", tone: "bg-sunken text-muted" },
};

export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  const user = await requireUser();
  const sp = await searchParams;
  const unreadOnly = sp.filter === "unread";
  await sweep();
  const now = currentTime();
  const all = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, user.id)).orderBy(desc(schema.notifications.createdAt)).limit(100);
  const unread = all.filter((n) => !n.read).length;
  const items = unreadOnly ? all.filter((n) => !n.read) : all;

  const today = campusDayAt(now, 0);
  const dayLabel = (ms: number) => {
    const start = campusDayAt(ms, 0);
    if (start === today) return "Today";
    if (start === today - DAY) return "Yesterday";
    return fmtDay(ms);
  };
  const groups: { label: string; items: typeof items }[] = [];
  for (const n of items) {
    const label = dayLabel(n.createdAt);
    const g = groups.at(-1);
    if (g?.label === label) g.items.push(n);
    else groups.push({ label, items: [n] });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader kicker="Inbox" title="Notifications" description={unread ? `${unread} unread` : "You're all caught up."}>
        {unread > 0 && (
          <form action={markAllReadAction}>
            <button className="btn-ghost">
              <Icon name="check" size={16} />
              Mark all read
            </button>
          </form>
        )}
      </PageHeader>

      <LinkTabs
        label="Filter notifications"
        className="mb-5"
        items={[
          { href: "/notifications", label: "All", count: all.length, active: !unreadOnly },
          { href: "/notifications?filter=unread", label: "Unread", count: unread, active: unreadOnly },
        ]}
      />

      {items.length === 0 ? (
        <EmptyState
          illustration={unreadOnly ? "check" : "inbox"}
          title={unreadOnly ? "Nothing unread" : "No notifications yet"}
          description={unreadOnly ? "Every update has been read." : "Approvals, reminders, waiting-list moves and incidents will land here."}
          action={unreadOnly ? <a href="/notifications" className="btn-ghost">Show all</a> : undefined}
        />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.label} aria-labelledby={`day-${g.label}`}>
              <h2 id={`day-${g.label}`} className="label sticky top-[calc(var(--header-h)+4px)] z-10 mb-2 inline-block rounded-md bg-paper/90 px-1 backdrop-blur">
                {g.label}
              </h2>
              <ul className="card stagger divide-y divide-line overflow-hidden">
                {g.items.map((n) => {
                  const k = KIND[n.kind] ?? { icon: "bell" as const, tone: "bg-sunken text-muted" };
                  return (
                    <li key={n.id} className={`group relative flex gap-3 p-4 transition-colors hover:bg-sunken/60 ${n.read ? "" : "bg-thread-soft/25"}`}>
                      <span className={`grid size-9 shrink-0 place-items-center rounded-full ${k.tone}`}>
                        <Icon name={k.icon} size={16} />
                      </span>
                      <div className="min-w-0 flex-1">
                        {/* Plain <a> (no prefetch): opening marks the notification read, then follows its link. */}
                        <a href={`/notifications/${n.id}/open`} className="block font-medium after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-thread">
                          {!n.read && <span className="sr-only">Unread: </span>}
                          <span className={n.read ? "text-ink/80" : ""}>{n.title}</span>
                        </a>
                        <p className="text-sm text-ink/75">{n.body}</p>
                        <p className="mt-1 text-xs text-muted tabular">
                          {fmtTime(n.createdAt)} · <RelativeTime ms={n.createdAt} now={now} />
                        </p>
                      </div>
                      <form action={setReadAction} className="relative z-[1] shrink-0 self-center">
                        <input type="hidden" name="id" value={n.id} />
                        <input type="hidden" name="read" value={n.read ? "0" : "1"} />
                        <Tooltip label={n.read ? "Mark as unread" : "Mark as read"}>
                          <button className="grid size-9 place-items-center rounded-lg text-muted transition-colors hover:bg-card hover:text-ink" aria-label={n.read ? `Mark “${n.title}” as unread` : `Mark “${n.title}” as read`}>
                            {n.read ? <span className="size-2.5 rounded-full border-2 border-line-strong" /> : <span className="size-2.5 rounded-full bg-saffron" />}
                          </button>
                        </Tooltip>
                      </form>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      <p className="mt-6 flex items-center gap-2 text-xs text-muted">
        <Icon name="info" size={14} />
        Reminders go out 24 h before a slot; overdue alerts go to both borrower and owner.
      </p>
    </div>
  );
}
