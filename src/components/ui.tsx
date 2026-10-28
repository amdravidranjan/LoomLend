import Link from "next/link";
import type { ReactNode } from "react";
import { STATUS_LABEL, conditionLabel } from "@/lib/catalog";
import type { Check, PriorityFactor } from "@/lib/rules";
import type { AdvisoryNote } from "@/lib/ai";

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-soft text-amber-900",
  approved: "bg-teal-soft text-teal",
  waitlisted: "bg-thread-soft text-thread",
  rejected: "bg-rose-soft text-rose",
  cancelled: "bg-zinc-100 text-zinc-600",
  checked_out: "bg-saffron-soft text-saffron",
  returned: "bg-sky-100 text-sky-800",
  closed: "bg-zinc-100 text-zinc-700",
  overdue: "bg-rose text-white",
  open: "bg-rose-soft text-rose",
  resolved: "bg-teal-soft text-teal",
  dismissed: "bg-zinc-100 text-zinc-600",
  active: "bg-teal-soft text-teal",
  maintenance: "bg-amber-soft text-amber-900",
  retired: "bg-zinc-100 text-zinc-600",
  verified: "bg-teal-soft text-teal",
};

export function Badge({ status, label, className = "" }: { status: string; label?: string; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${STATUS_STYLE[status] ?? "bg-zinc-100 text-zinc-700"} ${className}`}>
      {label ?? STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function Pill({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "warn" | "info" | "ok" }) {
  const t = { plain: "border-line bg-paper text-ink/80", warn: "border-amber-200 bg-amber-soft text-amber-900", info: "border-indigo-200 bg-thread-soft text-thread", ok: "border-teal-200 bg-teal-soft text-teal" }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${t}`}>{children}</span>;
}

export function PageHeader({ title, kicker, children }: { title: string; kicker?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {kicker && <p className="text-xs font-semibold tracking-widest text-saffron uppercase">{kicker}</p>}
        <h1 className="h-display text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      </div>
      {children}
    </div>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{children}</p>;
}

export function Checks({ checks }: { checks: Check[] }) {
  return (
    <ul className="space-y-2">
      {checks.map((c) => (
        <li key={c.key} className="flex gap-3 text-sm">
          <span
            className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${c.pass ? "bg-teal-soft text-teal" : "bg-rose-soft text-rose"}`}
            aria-label={c.pass ? "Met" : "Not met"}
          >
            {c.pass ? "✓" : "✕"}
          </span>
          <span>
            <span className="font-medium">{c.label}</span>
            <span className="block text-muted">{c.detail}</span>
            {!c.pass && c.fixHint && <span className="block text-thread">{c.fixHint}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Priority({ score, factors }: { score: number; factors: PriorityFactor[] }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer">
        Priority score <strong>{score}</strong> <span className="text-muted">(how this is calculated)</span>
      </summary>
      <ul className="mt-2 space-y-0.5 border-l-2 border-thread-soft pl-3">
        {factors.map((f) => (
          <li key={f.label} className="flex justify-between gap-4">
            <span className="text-muted">{f.label}</span>
            <span className={`font-mono ${f.points < 0 ? "text-rose" : ""}`}>{f.points > 0 ? `+${f.points}` : f.points}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function Advisory({ note, title = "Assistant notes" }: { note: AdvisoryNote | null; title?: string }) {
  if (!note) return null;
  const tone = { low: "ok", medium: "warn", high: "warn" } as const;
  return (
    <div className="rounded-lg border border-indigo-200 bg-thread-soft/40 p-3 text-sm">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="font-semibold text-thread">{title}</span>
        <Pill tone={tone[note.risk]}>Risk: {note.risk}</Pill>
        <span className="text-xs text-muted">{note.source === "claude" ? "Written by Claude · advisory only" : "Rule-based checks · advisory only"}</span>
      </div>
      <p>{note.summary}</p>
      {note.flags.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-ink/80">
          {note.flags.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-xs text-muted">The decision stays with a person. This note cannot approve, reject or penalise anyone.</p>
    </div>
  );
}

export function Condition({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted">—</span>;
  const bad = ["poor", "damaged"].includes(value);
  return <span className={bad ? "font-semibold text-rose" : "font-medium"}>{conditionLabel(value)}</span>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "ok" | "warn" | "error"; children: ReactNode }) {
  const t = { info: "border-indigo-200 bg-thread-soft/50 text-thread", ok: "border-teal-200 bg-teal-soft text-teal", warn: "border-amber-200 bg-amber-soft text-amber-900", error: "border-rose-200 bg-rose-soft text-rose" }[tone];
  return <div className={`rounded-lg border px-4 py-3 text-sm ${t}`} role={tone === "error" ? "alert" : "status"}>{children}</div>;
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-medium text-thread underline-offset-2 hover:underline">
      {children}
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
