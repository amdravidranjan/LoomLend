import Link from "next/link";
import { and, eq, count } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/catalog";
import { LogoLockup } from "./logo";
import { BellLink, MainNav, SearchTrigger, TabBar, UserMenu } from "./ds/nav-client";
import { ThemeToggle } from "./ds/client";
import { CommandPalette } from "./ds/command-palette";
import { Shortcuts } from "./ds/shortcuts";
import type { NavRole } from "./ds/nav-items";

/**
 * Site header (desktop: primary links + More, search, bell, account menu) and, for signed-in
 * people on phones, a bottom tab bar with Scan as the centre action. Also mounts the command
 * palette and keyboard shortcuts, which need to know the person's role.
 */
export async function Nav() {
  const user = await getCurrentUser();
  const unread = user
    ? (await db.select({ n: count() }).from(schema.notifications).where(and(eq(schema.notifications.userId, user.id), eq(schema.notifications.read, false))))[0].n
    : 0;
  const role: NavRole = user?.role ?? null;

  return (
    <>
      <header data-site-header style={{ viewTransitionName: "ll-header" }} className="no-print sticky top-0 z-40 border-b border-line bg-paper/85 backdrop-blur-md supports-[backdrop-filter]:bg-paper/75">
        <div className="mx-auto flex h-[var(--header-h)] max-w-6xl items-center gap-3 px-4 sm:px-6 lg:gap-5">
          <Link href="/" className="-ml-1 shrink-0 rounded-lg p-1" aria-label="LoomLend home">
            <LogoLockup size={28} />
          </Link>
          <MainNav role={role} />
          <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
            <SearchTrigger />
            {user ? (
              <>
                <BellLink unread={unread} />
                <UserMenu name={user.name} roleLabel={ROLE_LABEL[user.role]} department={user.department} />
              </>
            ) : (
              <>
                <ThemeToggle className="hidden sm:inline-flex" />
                <Link href="/login" className="btn-primary ml-1">
                  Sign in
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      {user && <TabBar role={role} unread={unread} />}
      <CommandPalette role={role} />
      <Shortcuts role={role} />
    </>
  );
}
