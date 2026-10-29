import Link from "next/link";
import type { ReactNode } from "react";
import { STATUS_LABEL, conditionLabel } from "@/lib/catalog";
import type { Check, PriorityFactor } from "@/lib/rules";
import type { AdvisoryNote } from "@/lib/ai";
import { Icon, type IconName } from "@/components/ds/icons";

/* Status → visual tone. One source of truth for every lifecycle state in the app. */
type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "accent" | "active" | "danger-solid";
const STATUS_TONE: Record<string, Tone> = {
  pending: "warning",
  approved: "success",
  waitlisted: "accent",
  rejected: "danger",
  cancelled: "neutral",
  checked_out: "active",
  returned: "info",
  closed: "neutral",
  overdue: "danger-solid",
  open: "danger",
  resolved: "success",
  dismissed: "neutral",
  active: "success",
  maintenance: "warning",
  retired: "neutral",
  verified: "success",
  drawn: "success",
  suspended: "danger",
};
const TONE_CLS: Record<Tone, { pill: string; dot: string }> = {
  neutral: { pill: "bg-sunken text-muted ring-line", dot: "bg-subtle" },
  info: { pill: "bg-sky-soft text-sky ring-sky/20", dot: "bg-sky" },
  success: { pill: "bg-teal-soft text-teal ring-teal/20", dot: "bg-teal" },
  warning: { pill: "bg-amber-soft text-amber-ink ring-amber/25", dot: "bg-amber" },
  danger: { pill: "bg-rose-soft text-rose ring-rose/20", dot: "bg-rose" },
  accent: { pill: "bg-thread-soft text-thread ring-thread/20", dot: "bg-thread" },
  active: { pill: "bg-saffron-soft text-saffron ring-saffron/25", dot: "bg-saffron" },
  "danger-solid": { pill: "bg-rose text-white ring-rose", dot: "bg-[#fff]" },
};

const EXTRA_LABEL: Record<string, string> = {
  overdue: "Overdue",
  open: "Open",
  resolved: "Resolved",
  dismissed: "Dismissed",
  active: "Active",
  maintenance: "Maintenance",
  retired: "Retired",
  verified: "Verified",
  drawn: "Drawn",
  suspended: "Suspended",
};

export function statusTone(status: string): Tone {
  return STATUS_TONE[status] ?? "neutral";
}

/**
 * A lifecycle status. Pass `animate` where the status may just have changed (after an action)
 * to play a short settle-in. In-progress states (in use, overdue) carry a live dot.
 */
export function Badge({ status, label, className = "", animate = false }: { status: string; label?: string; className?: string; animate?: boolean }) {
  const tone = statusTone(status);
  const t = TONE_CLS[tone];
  const live = status === "checked_out" || status === "overdue";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset ${t.pill} ${animate ? "status-in" : ""} ${className}`}
    >
      <span className="relative inline-flex size-1.5" aria-hidden>
        {live && <span className={`absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:hidden ${t.dot}`} />}
        <span className={`relative size-1.5 rounded-full ${t.dot}`} />
      </span>
      {label ?? STATUS_LABEL[status] ?? EXTRA_LABEL[status] ?? status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ")}
    </span>
  );
}

export function Pill({ children, tone = "plain", icon, title }: { children: ReactNode; tone?: "plain" | "warn" | "info" | "ok" | "danger"; icon?: IconName; title?: string }) {
  const t = {
    plain: "border-line bg-sunken/60 text-ink/80",
    warn: "border-amber-200 bg-amber-soft text-amber-ink",
    info: "border-indigo-200 bg-thread-soft text-thread",
    ok: "border-teal-200 bg-teal-soft text-teal",
    danger: "border-rose-200 bg-rose-soft text-rose",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs whitespace-nowrap ${t}`} title={title}>
      {icon && <Icon name={icon} size={12} strokeWidth={2} />}
      {children}
    </span>
  );
}

export function PageHeader({
  title,
  kicker,
  children,
  description,
  back,
}: {
  title: ReactNode;
  kicker?: ReactNode;
  children?: ReactNode;
  description?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="enter mb-6">
      {back && (
        <Link href={back.href} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink" transitionTypes={["nav-back"]}>
          <Icon name="arrowLeft" size={16} />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {kicker && <p className="text-xs font-semibold tracking-[0.14em] text-saffron uppercase">{kicker}</p>}
          <h1 className="h-display mt-0.5 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h1>
          {description && <p className="mt-2 max-w-2xl text-pretty text-muted">{description}</p>}
        </div>
        {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
      </div>
    </div>
  );
}

export function Section({
  title,
  children,
  aside,
  description,
  id,
  icon,
  className = "",
}: {
  title: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
  description?: ReactNode;
  id?: string;
  icon?: IconName;
  className?: string;
}) {
  return (
    <section className={`card p-5 ${className}`} id={id} aria-labelledby={id ? `${id}-title` : undefined}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h2 id={id ? `${id}-title` : undefined} className="flex items-center gap-2 text-base font-semibold">
            {icon && <Icon name={icon} size={18} className="text-muted" />}
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Lightweight empty message. For a richer one with an illustration and actions use EmptyState. */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line-strong/70 px-4 py-6 text-center text-sm text-muted">
      <svg width="44" height="14" viewBox="0 0 44 14" aria-hidden className="opacity-70">
        <path d="M2 7c5-6 9-6 14 0s9 6 14 0 9-6 12 0" fill="none" stroke="var(--line-strong)" strokeWidth="2" strokeLinecap="round" strokeDasharray="1 5" />
      </svg>
      <div>{children}</div>
    </div>
  );
}

export function Checks({ checks, summary = false }: { checks: Check[]; summary?: boolean }) {
  const met = checks.filter((c) => c.pass).length;
  return (
    <div>
      {summary && (
        <div className="mb-3 flex items-center gap-3 text-sm">
          <span className="font-medium tabular">
            {met} of {checks.length} met
          </span>
          <span className="block h-1.5 flex-1 overflow-hidden rounded-full bg-sunken" aria-hidden>
            <span className={`block h-full rounded-full ${met === checks.length ? "bg-teal" : "bg-amber"}`} style={{ width: `${checks.length ? (met / checks.length) * 100 : 0}%` }} />
          </span>
        </div>
      )}
      <ul className="space-y-2.5">
        {checks.map((c) => (
          <li key={c.key} className="flex gap-3 text-sm">
            <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${c.pass ? "bg-teal-soft text-teal" : "bg-rose-soft text-rose"}`}>
              <Icon name={c.pass ? "check" : "x"} size={12} strokeWidth={3} title={c.pass ? "Met" : "Not met"} />
            </span>
            <span className="min-w-0">
              <span className="font-medium">{c.label}</span>
              <span className="block text-muted">{c.detail}</span>
              {!c.pass && c.fixHint && (
                <span className="mt-0.5 flex items-start gap-1 text-thread">
                  <Icon name="arrowRight" size={14} className="mt-0.5" />
                  {c.fixHint}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Priority({ score, factors }: { score: number; factors: PriorityFactor[] }) {
  const max = Math.max(1, ...factors.map((f) => Math.abs(f.points)));
  return (
    <details className="group text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md py-1 [&::-webkit-details-marker]:hidden">
        <span className="grid h-7 min-w-9 place-items-center rounded-md bg-thread-soft px-1.5 font-semibold text-thread tabular">{score}</span>
        <span>
          Priority score <span className="text-muted">· how this is calculated</span>
        </span>
        <Icon name="chevronDown" size={16} className="text-muted transition-transform group-open:rotate-180" />
      </summary>
      <ul className="mt-2 space-y-1.5 border-l-2 border-thread-soft pl-3">
        {factors.map((f) => (
          <li key={f.label} className="grid grid-cols-[1fr_4rem_2.5rem] items-center gap-3">
            <span className="text-muted">{f.label}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
              <span className={`block h-full rounded-full ${f.points < 0 ? "bg-rose" : "bg-thread"}`} style={{ width: `${(Math.abs(f.points) / max) * 100}%` }} />
            </span>
            <span className={`text-right font-mono tabular ${f.points < 0 ? "text-rose" : ""}`}>{f.points > 0 ? `+${f.points}` : f.points}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function Advisory({ note, title = "Assistant notes" }: { note: AdvisoryNote | null; title?: string }) {
  if (!note) return null;
  const tone = { low: "ok", medium: "warn", high: "danger" } as const;
  return (
    <div className="rounded-xl border border-indigo-200 bg-thread-soft/40 p-4 text-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="grid size-6 place-items-center rounded-md bg-thread-soft text-thread">
          <Icon name="sparkle" size={14} />
        </span>
        <span className="font-semibold text-thread">{title}</span>
        <Pill tone={tone[note.risk]}>Risk: {note.risk}</Pill>
        <span className="text-xs text-muted">{note.source === "claude" ? "Written by Claude · advisory only" : "Rule-based checks · advisory only"}</span>
      </div>
      <p>{note.summary}</p>
      {note.flags.length > 0 && (
        <ul className="mt-2 space-y-1">
          {note.flags.map((f) => (
            <li key={f} className="flex gap-2 text-ink/85">
              <Icon name="flag" size={14} className="mt-0.5 text-muted" />
              {f}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
        <Icon name="user" size={13} />
        The decision stays with a person. This note cannot approve, reject or penalise anyone.
      </p>
    </div>
  );
}

export function Condition({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted">—</span>;
  const bad = ["poor", "damaged"].includes(value);
  return <span className={bad ? "font-semibold text-rose" : "font-medium"}>{conditionLabel(value)}</span>;
}

export function Notice({ tone = "info", children, title, action }: { tone?: "info" | "ok" | "warn" | "error"; children: ReactNode; title?: ReactNode; action?: ReactNode }) {
  const t = {
    info: { cls: "border-indigo-200 bg-thread-soft/50 text-thread", icon: "info" as const },
    ok: { cls: "border-teal-200 bg-teal-soft text-teal", icon: "check" as const },
    warn: { cls: "border-amber-200 bg-amber-soft text-amber-ink", icon: "alert" as const },
    error: { cls: "border-rose-200 bg-rose-soft text-rose", icon: "alert" as const },
  }[tone];
  return (
    <div className={`enter flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${t.cls}`} role={tone === "error" ? "alert" : "status"}>
      <Icon name={t.icon} size={18} className="mt-px" strokeWidth={2} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        <div className={title ? "mt-0.5 opacity-90" : ""}>{children}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function TextLink({ href, children, arrow = false }: { href: string; children: ReactNode; arrow?: boolean }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-1 font-medium text-thread underline-offset-4 hover:underline">
      {children}
      {arrow && <Icon name="arrowRight" size={14} className="transition-transform group-hover:translate-x-0.5" />}
    </Link>
  );
}

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
