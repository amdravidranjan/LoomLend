import Link from "next/link";
import { and, eq, count } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/catalog";
import { logoutAction } from "@/app/actions";
import { Logo } from "./logo";

export async function Nav() {
  const user = await getCurrentUser();
  const unread = user
    ? (await db.select({ n: count() }).from(schema.notifications).where(and(eq(schema.notifications.userId, user.id), eq(schema.notifications.read, false))))[0].n
    : 0;

  const links = user
    ? [
        { href: "/resources", label: "Discover" },
        { href: "/bookings", label: "My bookings" },
        ...(isStaff(user) ? [{ href: "/manage", label: "Manage" }] : []),
        ...(user.role === "admin" || user.role === "manager" ? [{ href: "/admin", label: user.role === "admin" ? "Admin desk" : "Verify & review" }] : []),
        { href: "/policy", label: "Fair use" },
      ]
    : [
        { href: "/resources", label: "Discover" },
        { href: "/policy", label: "Fair use" },
      ];

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2" aria-label="LoomLend home">
          <Logo />
          <span className="h-display text-xl font-semibold tracking-tight">LoomLend</span>
        </Link>
        <nav aria-label="Main" className="order-3 flex w-full gap-1 overflow-x-auto text-sm sm:order-none sm:w-auto">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-md px-3 py-1.5 whitespace-nowrap text-ink/80 hover:bg-card hover:text-ink">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          {user ? (
            <>
              <Link href="/notifications" className="relative rounded-md px-2 py-1.5 hover:bg-card" aria-label={`Notifications, ${unread} unread`}>
                <span aria-hidden>🔔</span>
                {unread > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 rounded-full bg-saffron px-1.5 text-[10px] font-bold text-white">{unread}</span>
                )}
              </Link>
              <Link href="/profile" className="hidden text-right leading-tight sm:block">
                <span className="block font-medium">{user.name}</span>
                <span className="block text-xs text-muted">{ROLE_LABEL[user.role]}</span>
              </Link>
              <form action={logoutAction}>
                <button className="btn-ghost px-3 py-1.5">Log out</button>
              </form>
            </>
          ) : (
            <Link href="/login" className="btn-primary">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
