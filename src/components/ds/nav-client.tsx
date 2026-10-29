"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { logoutAction } from "@/app/actions";
import { Icon } from "./icons";
import { Avatar, Kbd } from "./primitives";
import { ThemeToggle } from "./client";
import { isActive, navItems, type NavRole } from "./nav-items";
import { openPalette, openShortcuts } from "./events";

/* ------------------------------------------------------------------ Popover menu */

function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close, ref]);
}

function Menu({ button, label, children, align = "right", className = "" }: { button: (p: { open: boolean }) => ReactNode; label: string; children: (close: () => void) => ReactNode; align?: "left" | "right"; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }
  const close = () => setOpen(false);
  useDismiss(open, close, ref);
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg focus-visible:outline-2 focus-visible:outline-thread"
      >
        {button({ open })}
      </button>
      {open && (
        <div
          id={id}
          className={`pop absolute top-[calc(100%+8px)] z-50 w-64 origin-top rounded-xl border border-line bg-raised p-1.5 shadow-3 ${align === "right" ? "right-0" : "left-0"}`}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

function MenuLink({ href, icon, children, hint, onClick }: { href: string; icon: Parameters<typeof Icon>[0]["name"]; children: ReactNode; hint?: ReactNode; onClick?: () => void }) {
  const pathname = usePathname();
  const active = isActive(pathname, href);
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-10 items-center gap-3 rounded-lg px-2.5 py-2 text-sm hover:bg-sunken ${active ? "bg-sunken font-medium text-ink" : "text-ink/85"}`}
    >
      <Icon name={icon} size={17} className={active ? "text-thread" : "text-muted"} />
      <span className="flex-1">{children}</span>
      {hint}
    </Link>
  );
}

/* ------------------------------------------------------------------ Desktop navigation */

export function MainNav({ role }: { role: NavRole }) {
  const pathname = usePathname();
  const items = navItems(role);
  const primary = items.filter((i) => i.place === "primary");
  const more = items.filter((i) => i.place === "more");
  const moreActive = more.some((i) => isActive(pathname, i.href));
  return (
    <nav aria-label="Main" className="hidden items-center gap-0.5 md:flex">
      {primary.map((l) => {
        const active = isActive(pathname, l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`relative flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm whitespace-nowrap transition-colors lg:px-3 ${
              active ? "font-medium text-ink" : "text-ink/70 hover:bg-sunken hover:text-ink"
            }`}
          >
            <Icon name={l.icon} size={16} className={active ? "text-thread" : "opacity-70"} />
            {l.label}
            {active && <span className="absolute inset-x-2.5 -bottom-[13px] h-0.5 rounded-full bg-thread lg:inset-x-3" aria-hidden />}
          </Link>
        );
      })}
      <Menu
        label="More pages"
        align="left"
        button={({ open }) => (
          <span className={`flex h-9 items-center gap-1 rounded-lg px-2.5 text-sm ${moreActive ? "font-medium text-ink" : "text-ink/70 hover:bg-sunken hover:text-ink"}`}>
            More
            <Icon name="chevronDown" size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
          </span>
        )}
      >
        {(close) =>
          more.map((i) => (
            <MenuLink key={i.href} href={i.href} icon={i.icon} onClick={close}>
              <span className="block">{i.label}</span>
              {i.description && <span className="block text-xs font-normal text-muted">{i.description}</span>}
            </MenuLink>
          ))
        }
      </Menu>
    </nav>
  );
}

export function SearchTrigger() {
  return (
    <button
      type="button"
      onClick={() => openPalette()}
      className="group flex h-9 items-center gap-2 rounded-lg border border-line bg-card px-2.5 text-sm text-muted shadow-1 transition-colors hover:border-line-strong hover:text-ink max-lg:size-10 max-lg:justify-center max-lg:border-transparent max-lg:bg-transparent max-lg:px-0 max-lg:shadow-none"
      aria-label="Search and jump to (Ctrl K)"
      aria-keyshortcuts="Control+K Meta+K"
    >
      <Icon name="search" size={16} />
      <span className="hidden lg:inline">Search…</span>
      <span className="ml-3 hidden items-center gap-0.5 lg:flex">
        <Kbd>Ctrl</Kbd>
        <Kbd>K</Kbd>
      </span>
    </button>
  );
}

export function BellLink({ unread }: { unread: number }) {
  const pathname = usePathname();
  const active = isActive(pathname, "/notifications");
  return (
    <Link
      href="/notifications"
      className={`relative grid size-10 place-items-center rounded-lg transition-colors hover:bg-sunken ${active ? "text-thread" : "text-ink/75 hover:text-ink"}`}
      aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
      aria-current={active ? "page" : undefined}
      title="Notifications (g n)"
    >
      <Icon name="bell" size={19} />
      {unread > 0 && (
        <span className="status-in absolute top-1 right-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-saffron px-1 text-[10px] font-bold text-white ring-2 ring-paper tabular">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}

export function UserMenu({ name, roleLabel, department }: { name: string; roleLabel: string; department: string }) {
  return (
    <Menu
      label={`Account menu for ${name}`}
      button={({ open }) => (
        <span className={`flex items-center gap-2 rounded-lg p-1 pr-1.5 transition-colors hover:bg-sunken ${open ? "bg-sunken" : ""}`}>
          <Avatar name={name} size={30} />
          <span className="hidden text-left leading-tight whitespace-nowrap 2xl:block">
            <span className="block text-sm font-medium">{name}</span>
            <span className="block text-xs text-muted">{roleLabel}</span>
          </span>
          <Icon name="chevronDown" size={14} className="hidden text-muted 2xl:block" />
        </span>
      )}
    >
      {(close) => (
        <>
          <div className="flex items-center gap-3 border-b border-line px-2.5 pt-1.5 pb-3">
            <Avatar name={name} size={38} />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold">{name}</p>
              <p className="truncate text-xs text-muted">
                {roleLabel} · {department}
              </p>
            </div>
          </div>
          <div className="py-1">
            <MenuLink href="/profile" icon="user" onClick={close} hint={<Kbd>g p</Kbd>}>
              Profile & training
            </MenuLink>
            <MenuLink href="/notifications" icon="inbox" onClick={close} hint={<Kbd>g n</Kbd>}>
              Notifications
            </MenuLink>
            <button
              type="button"
              onClick={() => {
                close();
                openShortcuts();
              }}
              className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm text-ink/85 hover:bg-sunken"
            >
              <Icon name="keyboard" size={17} className="text-muted" />
              <span className="flex-1">Keyboard shortcuts</span>
              <Kbd>?</Kbd>
            </button>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-line px-2.5 py-2">
            <span className="text-sm text-muted">Theme</span>
            <ThemeToggle />
          </div>
          <form action={logoutAction} className="border-t border-line pt-1">
            <button className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm text-ink/85 hover:bg-rose-soft hover:text-rose">
              <Icon name="logout" size={17} />
              Sign out
            </button>
          </form>
        </>
      )}
    </Menu>
  );
}

/* ------------------------------------------------------------------ Mobile tab bar */

/**
 * Phone navigation, thumb-reachable (Fitts): Discover, Bookings, a raised Scan button in the
 * centre (check-in happens at the lab door), Ask, and More for everything else.
 */
export function TabBar({ role, unread }: { role: NavRole; unread: number }) {
  const pathname = usePathname();
  const [sheet, setSheet] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setSheet(false);
  }
  const items = navItems(role);
  const extra = items.filter((i) => !["/resources", "/bookings", "/scan", "/assistant"].includes(i.href));
  const moreActive = extra.some((i) => i.href !== "/" && isActive(pathname, i.href));
  const tab = (href: string, label: string, icon: Parameters<typeof Icon>[0]["name"]) => {
    const active = isActive(pathname, href);
    return (
      <Link href={href} aria-current={active ? "page" : undefined} className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${active ? "text-thread" : "text-muted"}`}>
        <span className={`grid h-7 w-12 place-items-center rounded-full transition-colors ${active ? "bg-thread-soft" : ""}`}>
          <Icon name={icon} size={20} strokeWidth={active ? 2.1 : 1.75} />
        </span>
        {label}
      </Link>
    );
  };
  const scanActive = isActive(pathname, "/scan");
  return (
    <>
      <nav
        aria-label="Primary"
        data-tabbar
        style={{ viewTransitionName: "ll-tabbar" }}
        className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      >
        <div className="mx-auto flex h-[68px] max-w-md items-stretch px-1">
          {tab("/resources", "Discover", "compass")}
          {tab("/bookings", "Bookings", "calendar")}
          <div className="flex flex-1 items-start justify-center">
            <Link
              href="/scan"
              aria-label="Scan a QR tag to check in or return"
              aria-current={scanActive ? "page" : undefined}
              className={`-mt-5 grid size-[60px] place-items-center rounded-2xl text-white shadow-3 ring-4 ring-paper transition-transform active:scale-95 ${scanActive ? "bg-thread-solid" : "bg-[#1e1b3a] dark:bg-thread-solid"}`}
            >
              <Icon name="scan" size={26} strokeWidth={2} />
              <span className="sr-only">Scan</span>
            </Link>
          </div>
          {tab("/assistant", "Ask", "sparkle")}
          <button
            type="button"
            onClick={() => setSheet(true)}
            aria-expanded={sheet}
            aria-haspopup="dialog"
            className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${moreActive ? "text-thread" : "text-muted"}`}
          >
            <span className={`grid h-7 w-12 place-items-center rounded-full ${moreActive ? "bg-thread-soft" : ""}`}>
              <Icon name="menu" size={20} />
            </span>
            More
            {unread > 0 && <span className="absolute top-2 right-[calc(50%-18px)] size-2 rounded-full bg-saffron ring-2 ring-paper" aria-label={`${unread} unread notifications`} />}
          </button>
        </div>
      </nav>
      {sheet && <MoreSheet items={extra} unread={unread} onClose={() => setSheet(false)} />}
    </>
  );
}

function MoreSheet({ items, unread, onClose }: { items: ReturnType<typeof navItems>; unread: number; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-label="More"
      className="ll-sheet mx-0 mt-auto mb-0 w-full max-w-none rounded-t-2xl border border-line bg-raised p-0 text-ink shadow-3 backdrop:bg-[var(--overlay)]"
    >
      <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong" aria-hidden />
      <div className="grid grid-cols-3 gap-1 p-3">
        {items.map((i) => (
          <Link key={i.href} href={i.href} onClick={onClose} className="relative flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl p-2 text-center text-xs font-medium text-ink/85 hover:bg-sunken">
            <span className="grid size-10 place-items-center rounded-xl bg-sunken text-ink/80">
              <Icon name={i.icon} size={20} />
            </span>
            {i.label}
            {i.href === "/notifications" && unread > 0 && (
              <span className="absolute top-2 right-[calc(50%-24px)] grid h-[18px] min-w-[18px] place-items-center rounded-full bg-saffron px-1 text-[10px] font-bold text-white">{unread}</span>
            )}
          </Link>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-line px-4 py-3">
        <span className="text-sm text-muted">Theme</span>
        <ThemeToggle />
      </div>
      <form action={logoutAction} className="border-t border-line p-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
        <button className="btn-ghost w-full">
          <Icon name="logout" size={17} />
          Sign out
        </button>
      </form>
    </dialog>
  );
}
