"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { DAY, HOUR, fmtDateTime } from "@/lib/time";
import { Icon } from "./icons";
import { toast } from "./toast";
import { THEME_KEY } from "./theme-script";

/* ------------------------------------------------------------------ CopyButton */

/** Copies text (e.g. a booking reference) and confirms with a check mark and a toast. */
export function CopyButton({ value, label = "Copy", className = "", showValue = false }: { value: string; label?: string; className?: string; showValue?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    toast({ tone: "success", title: `Copied ${value}`, duration: 2000 });
    window.setTimeout(() => setCopied(false), 1600);
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        copy();
      }}
      className={`group inline-flex items-center gap-1.5 rounded-md font-mono text-xs text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-thread ${showValue ? "border border-line bg-sunken px-1.5 py-0.5" : "p-1"} ${className}`}
      aria-label={copied ? `Copied ${value}` : `${label} ${value}`}
      title={copied ? "Copied" : `${label} ${value}`}
    >
      {showValue && <span className="tabular">{value}</span>}
      <span className="relative inline-grid size-3.5 place-items-center">
        <Icon name="copy" size={14} className={`transition-all duration-150 ${copied ? "scale-50 opacity-0" : "opacity-70 group-hover:opacity-100"}`} />
        <Icon name="check" size={14} strokeWidth={2.4} className={`absolute text-teal transition-all duration-150 ${copied ? "scale-100 opacity-100" : "scale-50 opacity-0"}`} />
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ RelativeTime */

export function relativeText(ms: number, now: number, style: "short" | "countdown" = "short") {
  const diff = ms - now;
  const abs = Math.abs(diff);
  if (abs < 45_000) return diff >= 0 ? "now" : "just now";
  let txt: string;
  if (abs < HOUR) txt = `${Math.round(abs / 60000)} min`;
  else if (abs < DAY) {
    const h = Math.floor(abs / HOUR);
    const m = Math.round((abs % HOUR) / 60000);
    txt = style === "countdown" && m > 0 && h < 6 ? `${h} h ${m} min` : `${Math.round(abs / HOUR)} h`;
  } else {
    const d = Math.round(abs / DAY);
    txt = d === 1 ? (diff >= 0 ? "tomorrow" : "yesterday") : `${d} days`;
    if (d === 1) return txt;
  }
  return diff >= 0 ? `in ${txt}` : `${txt} ago`;
}

/**
 * Relative time ("in 2 h 14 min") that keeps itself up to date, with the exact campus time in
 * the tooltip and the machine-readable value in <time dateTime>. Pass `now` from the server
 * (currentTime()) so the first render matches and nothing shifts on hydration.
 */
export function RelativeTime({ ms, now, style = "short", className = "", prefix }: { ms: number; now: number; style?: "short" | "countdown"; className?: string; prefix?: string }) {
  const [t, setT] = useState(now);
  useEffect(() => {
    const tick = () => setT(Date.now());
    const first = window.setTimeout(tick, 0);
    const iv = window.setInterval(tick, Math.abs(ms - Date.now()) < 2 * HOUR ? 15_000 : 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(iv);
    };
  }, [ms]);
  const exact = fmtDateTime(ms);
  return (
    <time dateTime={new Date(ms).toISOString()} title={exact} className={`tabular ${className}`}>
      {prefix}
      {relativeText(ms, t, style)}
    </time>
  );
}

/* ------------------------------------------------------------------ Tabs (client, with panels) */

/** Accessible tabs (roving focus, arrow keys, Home/End) for switching panels in place. */
export function Tabs({ tabs, defaultIndex = 0, className = "" }: { tabs: { label: ReactNode; content: ReactNode; count?: number }[]; defaultIndex?: number; className?: string }) {
  const [active, setActive] = useState(defaultIndex);
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKey(e: KeyboardEvent) {
    const n = tabs.length;
    const next = e.key === "ArrowRight" ? (active + 1) % n : e.key === "ArrowLeft" ? (active - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    setActive(next);
    refs.current[next]?.focus();
  }
  return (
    <div className={className}>
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]" onKeyDown={onKey}>
        {tabs.map((t, i) => (
          <button
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            id={`${id}-tab-${i}`}
            aria-selected={i === active}
            aria-controls={`${id}-panel-${i}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            className={`-mb-px flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm whitespace-nowrap transition-colors ${
              i === active ? "border-thread font-medium text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
            {t.count !== undefined && <span className="rounded-full bg-sunken px-1.5 text-[11px] font-semibold text-muted tabular">{t.count}</span>}
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div key={i} role="tabpanel" id={`${id}-panel-${i}`} aria-labelledby={`${id}-tab-${i}`} hidden={i !== active} tabIndex={0} className="pt-4 focus-visible:outline-none">
          {i === active && <div className="enter">{t.content}</div>}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ Theme */

export type ThemePref = "system" | "light" | "dark";

function resolve(pref: ThemePref) {
  return pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
}

export function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  root.classList.add("theme-switching");
  root.dataset.theme = resolve(pref);
  root.dataset.themePref = pref;
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {}
  document.cookie = `${THEME_KEY}=${pref}; path=/; max-age=31536000; samesite=lax`;
  window.setTimeout(() => root.classList.remove("theme-switching"), 50);
  window.dispatchEvent(new CustomEvent("ll-theme", { detail: pref }));
}

export function useThemePref() {
  const [pref, setPref] = useState<ThemePref>("system");
  useEffect(() => {
    const read = () => setPref((document.documentElement.dataset.themePref as ThemePref) || "system");
    const first = window.setTimeout(read, 0);
    const onChange = () => read();
    window.addEventListener("ll-theme", onChange);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystem = () => {
      if ((document.documentElement.dataset.themePref || "system") === "system") document.documentElement.dataset.theme = mq.matches ? "dark" : "light";
    };
    mq.addEventListener("change", onSystem);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("ll-theme", onChange);
      mq.removeEventListener("change", onSystem);
    };
  }, []);
  return [pref, (p: ThemePref) => applyTheme(p)] as const;
}

/** Three-way segmented control: follow the system, or force light / dark. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [pref, set] = useThemePref();
  const opts: { v: ThemePref; icon: "monitor" | "sun" | "moon"; label: string }[] = [
    { v: "system", icon: "monitor", label: "Match system" },
    { v: "light", icon: "sun", label: "Light" },
    { v: "dark", icon: "moon", label: "Dark" },
  ];
  return (
    <div role="radiogroup" aria-label="Colour theme" className={`inline-flex rounded-lg border border-line bg-sunken p-0.5 ${className}`}>
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={pref === o.v}
          title={o.label}
          aria-label={o.label}
          onClick={() => set(o.v)}
          className={`grid size-8 place-items-center rounded-md transition-colors ${pref === o.v ? "bg-card text-ink shadow-1" : "text-muted hover:text-ink"}`}
        >
          <Icon name={o.icon} size={16} />
        </button>
      ))}
    </div>
  );
}
