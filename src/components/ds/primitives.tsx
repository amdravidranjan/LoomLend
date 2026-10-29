import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

/* ------------------------------------------------------------------ Tooltip */

/** CSS-only tooltip shown on hover and keyboard focus. The label is also read by screen readers. */
export function Tooltip({ label, side = "top", children, className = "" }: { label: ReactNode; side?: "top" | "bottom"; children: ReactNode; className?: string }) {
  return (
    <span className={`tip inline-flex ${className}`} data-side={side}>
      {children}
      <span role="tooltip">{label}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ Skeleton */

export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <span className={`skeleton block ${className}`} aria-hidden />;
}

export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <span className={`block space-y-2 ${className}`} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={`h-3.5 ${i === lines - 1 ? "w-3/5" : "w-full"}`} />
      ))}
    </span>
  );
}

export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div className={`card p-4 ${className}`} aria-hidden>
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <SkeletonText lines={2} className="mt-4" />
    </div>
  );
}

/* ------------------------------------------------------------------ Kbd */

export function Kbd({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={`inline-flex min-w-[1.4rem] items-center justify-center rounded-[5px] border border-line-strong border-b-2 bg-card px-1.5 font-sans text-[11px] leading-[1.15rem] font-medium text-muted ${className}`}
    >
      {children}
    </kbd>
  );
}

/* ------------------------------------------------------------------ Avatar */

const AVATAR_TONES = [
  ["#e6e7ff", "#3730a3"],
  ["#ffedd5", "#9a3412"],
  ["#d7f4ec", "#0f5f58"],
  ["#ffe4e6", "#9f1239"],
  ["#fef3c7", "#854d0e"],
  ["#e0f2fe", "#075985"],
  ["#f3e8ff", "#6b21a8"],
  ["#ecfccb", "#3f6212"],
];

export function initials(name: string) {
  const parts = name.replace(/^(Dr\.|Prof\.)\s+/i, "").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Initials on a colour chosen deterministically from the name, so a person is always the same colour. */
export function Avatar({ name, size = 36, className = "", ring = false }: { name: string; size?: number; className?: string; ring?: boolean }) {
  const [bg, fg] = AVATAR_TONES[hashString(name) % AVATAR_TONES.length];
  return (
    <span
      className={`inline-grid shrink-0 place-items-center rounded-full font-semibold select-none ${ring ? "ring-2 ring-card" : ""} ${className}`}
      style={{ width: size, height: size, background: bg, color: fg, fontSize: Math.max(10, Math.round(size * 0.38)) }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/* ------------------------------------------------------------------ Stepper */

export type Step = { label: string; description?: ReactNode };

/** Progress through a sequence, drawn as a thread that fills in as steps complete. */
export function Stepper({ steps, current, orientation = "horizontal", className = "" }: { steps: Step[]; current: number; orientation?: "horizontal" | "vertical"; className?: string }) {
  const vertical = orientation === "vertical";
  return (
    <ol className={`${vertical ? "space-y-0" : "flex items-start"} ${className}`} aria-label="Progress">
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        const last = i === steps.length - 1;
        return (
          <li key={s.label} className={`relative ${vertical ? "flex gap-3 pb-5 last:pb-0" : "flex flex-1 flex-col items-center text-center"}`} aria-current={state === "current" ? "step" : undefined}>
            {!last && (
              <span
                aria-hidden
                className={`absolute ${vertical ? "top-7 bottom-0 left-[13px] w-0.5" : "top-[13px] left-[calc(50%+16px)] h-0.5 w-[calc(100%-32px)]"} ${i < current ? "bg-thread" : "bg-line"}`}
              />
            )}
            <span
              className={`relative z-[1] grid size-7 shrink-0 place-items-center rounded-full border-2 text-xs font-semibold tabular ${
                state === "done" ? "border-thread bg-thread text-white" : state === "current" ? "border-thread bg-card text-thread" : "border-line-strong bg-card text-muted"
              }`}
            >
              {state === "done" ? <Icon name="check" size={14} strokeWidth={2.5} /> : i + 1}
              {state === "current" && <span className="absolute inset-0 rounded-full pulse-ring" aria-hidden />}
            </span>
            <span className={vertical ? "pt-0.5" : "mt-2 px-1"}>
              <span className={`block text-sm ${state === "todo" ? "text-muted" : "font-medium text-ink"}`}>{s.label}</span>
              {s.description && <span className="block text-xs text-muted">{s.description}</span>}
              <span className="sr-only">{state === "done" ? " (completed)" : state === "current" ? " (current step)" : ""}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ Tabs (link-based) */

export type TabItem = { href: string; label: string; count?: number; active?: boolean; icon?: IconName };

/** Server-friendly tabs that are links (filters, sub-views). The active tab carries aria-current. */
export function LinkTabs({ items, label, className = "" }: { items: TabItem[]; label: string; className?: string }) {
  return (
    <nav aria-label={label} className={`-mx-1 overflow-x-auto [scrollbar-width:none] ${className}`}>
      <ul className="flex min-w-max gap-1 border-b border-line px-1">
        {items.map((t) => (
          <li key={`${t.href}|${t.label}`}>
            <Link
              href={t.href}
              scroll={false}
              aria-current={t.active ? "page" : undefined}
              className={`relative -mb-px flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm transition-colors ${
                t.active ? "border-thread font-medium text-ink" : "border-transparent text-muted hover:border-line-strong hover:text-ink"
              }`}
            >
              {t.icon && <Icon name={t.icon} size={16} />}
              {t.label}
              {t.count !== undefined && (
                <span className={`rounded-full px-1.5 text-[11px] font-semibold tabular ${t.active ? "bg-thread-soft text-thread" : "bg-sunken text-muted"}`}>{t.count}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* ------------------------------------------------------------------ Empty states */

export type Illustration = "spool" | "loom" | "inbox" | "needle" | "knot" | "check";

/** Small line illustrations in the thread vocabulary. */
export function ThreadIllustration({ kind, size = 96 }: { kind: Illustration; size?: number }) {
  const common = { fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" aria-hidden className="ll-illus">
      <circle cx="48" cy="48" r="44" fill="var(--sunken)" />
      {kind === "spool" && (
        <g {...common}>
          <rect x="30" y="24" width="36" height="8" rx="3" fill="var(--card)" stroke="var(--line-strong)" strokeWidth="2" />
          <rect x="30" y="64" width="36" height="8" rx="3" fill="var(--card)" stroke="var(--line-strong)" strokeWidth="2" />
          <rect x="36" y="32" width="24" height="32" fill="var(--card)" stroke="var(--line-strong)" strokeWidth="2" />
          {[38, 44, 50, 56].map((y) => (
            <path key={y} d={`M37 ${y}h22`} stroke="var(--thread)" strokeWidth="2.5" opacity={y === 56 ? 0.35 : 0.8} />
          ))}
          <path d="M59 50c8 0 10 8 16 8s6-6 10-6" stroke="var(--saffron)" strokeWidth="2.5" className="ll-illus-draw" />
        </g>
      )}
      {kind === "loom" && (
        <g {...common}>
          {[30, 40, 50, 60, 70].map((x) => (
            <path key={x} d={`M${x} 22v52`} stroke="var(--line-strong)" strokeWidth="2.5" />
          ))}
          <path d="M22 40c8-6 12 6 20 0s12 6 20 0 12 6 14 0" stroke="var(--thread)" strokeWidth="3" className="ll-illus-draw" />
          <path d="M22 56c8-6 12 6 20 0" stroke="var(--saffron)" strokeWidth="3" strokeDasharray="2 6" />
          <circle cx="66" cy="62" r="9" fill="var(--card)" stroke="var(--muted)" strokeWidth="2.5" />
          <path d="m72.5 68.5 7 7" stroke="var(--muted)" strokeWidth="3" />
        </g>
      )}
      {kind === "inbox" && (
        <g {...common}>
          <path d="M24 52 31 30h34l7 22v14a3 3 0 0 1-3 3H27a3 3 0 0 1-3-3V52Z" fill="var(--card)" stroke="var(--line-strong)" strokeWidth="2" />
          <path d="M24 52h14l3 6h14l3-6h14" stroke="var(--line-strong)" strokeWidth="2" />
          <path d="M36 42c4-4 8 4 12 0s8 4 12 0" stroke="var(--teal)" strokeWidth="2.5" className="ll-illus-draw" />
        </g>
      )}
      {kind === "needle" && (
        <g {...common}>
          <path d="M28 70 66 26" stroke="var(--muted)" strokeWidth="3" />
          <ellipse cx="63" cy="29.5" rx="2" ry="4.5" transform="rotate(41 63 29.5)" fill="var(--sunken)" stroke="var(--muted)" strokeWidth="1.5" />
          <path d="M62 31c10 6 12 20 2 24s-26 0-30 10" stroke="var(--saffron)" strokeWidth="2.5" strokeDasharray="3 5" />
        </g>
      )}
      {kind === "knot" && (
        <g {...common}>
          <path d="M18 50c10 0 14-14 26-14 14 0 14 22 2 22-10 0-8-16 6-16 10 0 14 8 26 8" stroke="var(--rose)" strokeWidth="3" className="ll-illus-draw" />
          <path d="M18 62h60" stroke="var(--line-strong)" strokeWidth="2" strokeDasharray="2 5" />
        </g>
      )}
      {kind === "check" && (
        <g {...common}>
          {[34, 48, 62].map((x) => (
            <path key={x} d={`M${x} 24v48`} stroke="var(--line-strong)" strokeWidth="2.5" />
          ))}
          <path d="M26 50l14 12 30-28" stroke="var(--teal)" strokeWidth="4" className="ll-illus-draw" />
        </g>
      )}
    </svg>
  );
}

/** An empty state that always offers a next step. */
export function EmptyState({
  title,
  description,
  illustration = "loom",
  action,
  secondary,
  compact = false,
  className = "",
}: {
  title: string;
  description?: ReactNode;
  illustration?: Illustration;
  action?: ReactNode;
  secondary?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center rounded-xl border border-dashed border-line-strong/70 text-center ${compact ? "px-4 py-6" : "px-6 py-10"} ${className}`}>
      <ThreadIllustration kind={illustration} size={compact ? 64 : 96} />
      <p className={`mt-3 font-semibold text-ink ${compact ? "text-sm" : "text-base"}`}>{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {(action || secondary) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondary}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Stat */

export function Stat({ value, label, hint, tone = "ink", className = "" }: { value: ReactNode; label: ReactNode; hint?: ReactNode; tone?: "ink" | "thread" | "saffron" | "teal" | "rose"; className?: string }) {
  const c = { ink: "text-ink", thread: "text-thread", saffron: "text-saffron", teal: "text-teal", rose: "text-rose" }[tone];
  return (
    <div className={className}>
      <p className={`h-display text-3xl font-semibold tabular ${c}`}>{value}</p>
      <p className="text-sm text-muted">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-subtle">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ Meter */

/** A thin progress thread, e.g. requirements met or hours used of a cap. */
export function Meter({ value, max, tone = "thread", label, className = "" }: { value: number; max: number; tone?: "thread" | "teal" | "saffron" | "rose"; label: string; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const c = { thread: "bg-thread", teal: "bg-teal", saffron: "bg-saffron", rose: "bg-rose" }[tone];
  return (
    <span className={`block h-1.5 overflow-hidden rounded-full bg-sunken ${className}`} role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
      <span className={`block h-full rounded-full ${c} transition-[width] duration-500`} style={{ width: `${pct}%` }} />
    </span>
  );
}
