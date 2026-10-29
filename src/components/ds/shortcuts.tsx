"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./icons";
import { Kbd } from "./primitives";
import { navItems, type NavRole } from "./nav-items";
import { SHORTCUTS_EVENT, openPalette } from "./events";

function typing(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

/**
 * Global keyboard shortcuts: "g" then a letter to jump (g d → Discover), "/" to focus the page's
 * search field (or open the palette), "?" for this sheet. Never fires while typing in a field.
 */
export function Shortcuts({ role }: { role: NavRole }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [chord, setChord] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const items = useMemo(() => navItems(role).filter((i) => i.key), [role]);
  const gAt = useRef(0);

  useEffect(() => {
    let timer = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      if (document.querySelector("dialog[open]") && e.key !== "?") return;
      const k = e.key.toLowerCase();
      if (Date.now() - gAt.current < 1200) {
        gAt.current = 0;
        setChord(false);
        const dest = items.find((i) => i.key === k);
        if (dest) {
          e.preventDefault();
          router.push(dest.href);
        }
        return;
      }
      if (k === "g") {
        gAt.current = Date.now();
        setChord(true);
        window.clearTimeout(timer);
        timer = window.setTimeout(() => setChord(false), 1200);
      } else if (e.key === "?") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/") {
        const search = document.querySelector<HTMLInputElement>("[data-page-search]");
        e.preventDefault();
        if (search) {
          search.focus();
          search.select();
        } else openPalette();
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(SHORTCUTS_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(SHORTCUTS_EVENT, onOpen);
      window.clearTimeout(timer);
    };
  }, [items, router]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    if (open) setOpen(false);
  }

  return (
    <>
      {chord && (
        <div className="pop no-print fixed bottom-6 left-1/2 z-[80] hidden -translate-x-1/2 items-center gap-2 rounded-xl border border-line bg-raised px-3 py-2 text-sm text-muted shadow-3 md:flex" role="status">
          <Kbd>g</Kbd> then…
          {items.slice(0, 6).map((i) => (
            <span key={i.href} className="flex items-center gap-1">
              <Kbd>{i.key}</Kbd>
              <span className="text-xs">{i.label}</span>
            </span>
          ))}
        </div>
      )}
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === dialog.current) setOpen(false);
        }}
        aria-labelledby="ll-keys-title"
        className="ll-dialog m-auto w-[min(34rem,calc(100vw-2rem))] rounded-2xl border border-line bg-raised p-0 text-ink shadow-3 backdrop:bg-[var(--overlay)]"
      >
        {open && (
          <div className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="ll-keys-title" className="flex items-center gap-2 text-base font-semibold">
                <Icon name="keyboard" size={18} className="text-muted" />
                Keyboard shortcuts
              </h2>
              <button type="button" onClick={() => setOpen(false)} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-sunken hover:text-ink" aria-label="Close">
                <Icon name="x" size={18} />
              </button>
            </div>
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <p className="label">Anywhere</p>
                <dl className="space-y-2 text-sm">
                  {[
                    [["Ctrl", "K"], "Search & jump"],
                    [["/"], "Focus search"],
                    [["?"], "This sheet"],
                    [["Esc"], "Close dialogs"],
                  ].map(([keys, label]) => (
                    <div key={label as string} className="flex items-center justify-between gap-3">
                      <dt className="text-ink/85">{label}</dt>
                      <dd className="flex gap-1">
                        {(keys as string[]).map((k) => (
                          <Kbd key={k}>{k}</Kbd>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div>
                <p className="label">Go to</p>
                <dl className="space-y-2 text-sm">
                  {items.map((i) => (
                    <div key={i.href} className="flex items-center justify-between gap-3">
                      <dt className="text-ink/85">{i.label}</dt>
                      <dd className="flex gap-1">
                        <Kbd>g</Kbd>
                        <Kbd>{i.key}</Kbd>
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
