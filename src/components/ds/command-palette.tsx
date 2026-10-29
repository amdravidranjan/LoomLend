"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { STATUS_LABEL } from "@/lib/catalog";
import { Icon, type IconName } from "./icons";
import { Kbd } from "./primitives";
import { applyTheme } from "./client";
import { navItems, type NavRole } from "./nav-items";
import { PALETTE_EVENT, openShortcuts } from "./events";

type PaletteData = {
  resources: { id: string; name: string; emoji: string; location: string; category: string; department: string; tags: string; status: string }[];
  bookings: { id: string; ref: string; resource: string; emoji: string; status: string; start: number }[];
};
type Entry = { id: string; group: string; label: string; hint?: string; icon?: IconName; emoji?: string; keywords: string; run: () => void; kbd?: string };

/** Subsequence match with bonuses for word starts and contiguous runs. Returns -1 for no match. */
export function fuzzyScore(query: string, text: string) {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) return 1000 - direct + (direct === 0 || /\W/.test(t[direct - 1]) ? 200 : 0);
  let score = 0;
  let ti = 0;
  let run = 0;
  for (const ch of q) {
    if (ch === " ") continue;
    const at = t.indexOf(ch, ti);
    if (at < 0) return -1;
    run = at === ti ? run + 1 : 0;
    score += 10 + run * 5 + (at === 0 || /\W/.test(t[at - 1]) ? 15 : 0) - Math.min(9, at - ti);
    ti = at + 1;
  }
  return score;
}

/**
 * Ctrl/Cmd+K: jump to any page, open a resource by name, find one of your bookings, or run a
 * command (theme, shortcuts). Keyboard-first: arrows, Enter, Escape; also works by touch.
 */
export function CommandPalette({ role }: { role: NavRole }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [data, setData] = useState<PaletteData | null>(null);
  const fetched = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = (e: Event) => {
      setQ((e as CustomEvent<string>).detail ?? "");
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(PALETTE_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      window.setTimeout(() => input.current?.focus(), 0);
      if (!fetched.current) {
        fetched.current = true;
        fetch("/api/palette")
          .then((r) => (r.ok ? r.json() : { resources: [], bookings: [] }))
          .then((j: PaletteData) => setData(j))
          .catch(() => setData({ resources: [], bookings: [] }));
      }
    }
    if (!open && d.open) d.close();
  }, [open]);

  const close = () => {
    setOpen(false);
    setQ("");
    setSel(0);
  };
  const go = (href: string) => {
    close();
    router.push(href);
  };

  const entries = useMemo<Entry[]>(() => {
    const pages: Entry[] = navItems(role).map((i) => ({
      id: `p:${i.href}`,
      group: "Go to",
      label: i.label,
      hint: i.description,
      icon: i.icon,
      keywords: `${i.label} ${i.description ?? ""} ${i.href}`,
      kbd: i.key ? `g ${i.key}` : undefined,
      run: () => go(i.href),
    }));
    const res: Entry[] = (data?.resources ?? []).map((r) => ({
      id: `r:${r.id}`,
      group: "Resources",
      label: r.name,
      hint: `${r.location}${r.status === "maintenance" ? " · under maintenance" : ""}`,
      emoji: r.emoji,
      keywords: `${r.name} ${r.location} ${r.department} ${r.category} ${r.tags}`,
      run: () => go(`/resources/${r.id}`),
    }));
    const bks: Entry[] = (data?.bookings ?? []).map((b) => ({
      id: `b:${b.id}`,
      group: "Your bookings",
      label: `${b.resource}`,
      hint: `${b.ref} · ${STATUS_LABEL[b.status] ?? b.status}`,
      emoji: b.emoji,
      keywords: `${b.ref} ${b.resource} ${b.status}`,
      run: () => go(`/bookings/${b.id}`),
    }));
    const cmds: Entry[] = [
      { id: "c:search", group: "Commands", label: q ? `Search Discover for “${q}”` : "Search Discover…", icon: "search", keywords: "search find discover", run: () => go(`/resources${q ? `?q=${encodeURIComponent(q)}` : ""}`) },
      { id: "c:light", group: "Commands", label: "Switch to light theme", icon: "sun", keywords: "theme light mode appearance", run: () => (applyTheme("light"), close()) },
      { id: "c:dark", group: "Commands", label: "Switch to dark theme", icon: "moon", keywords: "theme dark mode night appearance", run: () => (applyTheme("dark"), close()) },
      { id: "c:system", group: "Commands", label: "Match system theme", icon: "monitor", keywords: "theme system auto appearance", run: () => (applyTheme("system"), close()) },
      { id: "c:keys", group: "Commands", label: "Keyboard shortcuts", icon: "keyboard", keywords: "keys shortcuts help", kbd: "?", run: () => (close(), openShortcuts()) },
    ];
    return [...pages, ...bks, ...res, ...cmds];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, role, q]);

  const results = useMemo(() => {
    if (!q.trim()) {
      const pick = entries.filter((e) => e.group === "Go to" || e.group === "Your bookings").slice(0, 14);
      return [...pick, ...entries.filter((e) => e.id === "c:keys" || e.id === "c:dark" || e.id === "c:light")];
    }
    return entries
      .filter((e) => e.id !== "c:search")
      .map((e) => ({ e, s: Math.max(fuzzyScore(q, e.label) * 2, fuzzyScore(q, e.keywords)) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 20)
      .map((x) => x.e)
      .concat(entries.filter((e) => e.id === "c:search"))
      .filter((e, i, arr) => arr.findIndex((x) => x.id === e.id) === i);
  }, [q, entries]);

  const active = Math.min(sel, Math.max(0, results.length - 1));

  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const groups: { name: string; items: { e: Entry; i: number }[] }[] = [];
  results.forEach((e, i) => {
    const g = groups.find((x) => x.name === e.group) ?? groups[groups.push({ name: e.group, items: [] }) - 1];
    g.items.push({ e, i });
  });

  return (
    <dialog
      ref={dialog}
      onClose={close}
      onClick={(e) => {
        if (e.target === dialog.current) close();
      }}
      aria-label="Search and jump to"
      className="ll-dialog mx-auto mt-[12vh] mb-auto w-[min(40rem,calc(100vw-1.5rem))] max-w-none overflow-hidden rounded-2xl border border-line bg-raised p-0 text-ink shadow-3 backdrop:bg-[var(--overlay)]"
    >
      {open && (
        <div
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(results.length - 1, Math.min(s, results.length - 1) + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(0, Math.min(s, results.length - 1) - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              results[active]?.run();
            }
          }}
        >
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Icon name="search" size={18} className="text-muted" />
            <input
              ref={input}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setSel(0);
              }}
              placeholder="Search pages, resources, bookings…"
              className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-subtle focus-visible:outline-none"
              role="combobox"
              aria-expanded
              aria-controls="ll-palette-list"
              aria-activedescendant={results[active] ? `ll-pal-${active}` : undefined}
              aria-autocomplete="list"
              autoComplete="off"
              spellCheck={false}
            />
            {!data && <span className="text-xs text-muted">Loading…</span>}
            <Kbd>Esc</Kbd>
          </div>
          <ul ref={list} id="ll-palette-list" role="listbox" aria-label="Results" className="max-h-[min(60vh,28rem)] overflow-y-auto p-2">
            {results.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted">No matches. Try a resource name, a booking ref like LL-…, or a page.</li>}
            {groups.map((g) => (
              <li key={g.name} role="presentation">
                <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-subtle uppercase">{g.name}</p>
                <ul role="presentation">
                  {g.items.map(({ e, i }) => (
                    <li
                      key={e.id}
                      id={`ll-pal-${i}`}
                      data-index={i}
                      role="option"
                      aria-selected={i === active}
                      onMouseMove={() => setSel(i)}
                      onClick={() => e.run()}
                      className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${i === active ? "bg-thread-soft text-ink" : "text-ink/85"}`}
                    >
                      <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${i === active ? "bg-card" : "bg-sunken"}`}>
                        {e.emoji ? <span aria-hidden>{e.emoji}</span> : e.icon ? <Icon name={e.icon} size={16} className={i === active ? "text-thread" : "text-muted"} /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{e.label}</span>
                        {e.hint && <span className="block truncate text-xs text-muted">{e.hint}</span>}
                      </span>
                      {e.kbd && <Kbd className="hidden sm:inline-flex">{e.kbd}</Kbd>}
                      {i === active && <Icon name="arrowRight" size={16} className="text-thread" />}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <div className="hidden items-center gap-4 border-t border-line bg-sunken/60 px-4 py-2 text-xs text-muted sm:flex">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> move
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Enter</Kbd> open
            </span>
            <span className="ml-auto flex items-center gap-1">
              <Kbd>?</Kbd> all shortcuts
            </span>
          </div>
        </div>
      )}
    </dialog>
  );
}
