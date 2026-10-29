import Link from "next/link";
import type { ApprovalPath, OptionCard as Card } from "@/lib/assistant-types";
import { Icon } from "@/components/ds/icons";

const PATH_STYLE: Record<ApprovalPath, string> = {
  instant: "bg-teal-soft text-teal",
  review: "bg-thread-soft text-thread",
  supervised: "bg-amber-soft text-amber-900",
  draw: "bg-saffron-soft text-saffron",
  waitlist: "bg-sky-100 text-sky-800",
  blocked: "bg-rose-soft text-rose",
};

export function OptionCard({ card, index }: { card: Card; index: number }) {
  const missing = card.requirements.filter((r) => !r.met);
  const met = card.requirements.filter((r) => r.met);
  return (
    <article className="card flex flex-col gap-3 p-4" aria-label={`Option ${index + 1}: ${card.resourceName}, ${card.slotLabel}`}>
      <header className="flex items-start gap-3">
        <span className="text-2xl leading-none" aria-hidden>
          {card.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-ink">{card.resourceName}</h3>
          <p className="text-xs text-muted">{card.location}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${PATH_STYLE[card.path]}`}>{card.pathLabel}</span>
      </header>

      <p className="flex items-center gap-2 text-sm font-medium text-ink">
        <Icon name="clock" size={16} className="text-muted" />
        {card.slotLabel}
      </p>
      {card.why && <p className="text-sm text-ink/85">{card.why}</p>}
      <p className="text-xs text-muted">{card.pathDetail}</p>
      {card.contested && card.path !== "waitlist" && (
        <p className="text-xs text-amber-900">Someone else has also asked for overlapping time; requests are ordered by the published priority score.</p>
      )}

      {card.requirements.length > 0 && (
        <ul className="space-y-1.5 text-xs" aria-label="Requirements">
          {missing.map((r) => (
            <li key={r.label} className="flex gap-2">
              <Icon name="x" size={14} className="mt-0.5 text-rose" title="Not met" />
              <span>
                <span className="font-medium text-ink">{r.label}.</span> <span className="text-muted">{r.detail}</span>
                {r.fix && (
                  <span className="block text-ink">
                    {r.fix}{" "}
                    {r.href && (
                      <Link href={r.href} className="font-medium text-thread underline-offset-2 hover:underline">
                        {r.href === "/profile" ? "Open profile" : "Open"}
                      </Link>
                    )}
                  </span>
                )}
              </span>
            </li>
          ))}
          {met.map((r) => (
            <li key={r.label} className="flex gap-2 text-muted">
              <Icon name="check" size={14} className="mt-0.5 text-teal" title="Met" />
              <span>{r.label}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        {card.eligible ? (
          <Link href={card.requestHref} className="btn-primary">
            {card.path === "waitlist" ? "Join the waiting list" : card.path === "draw" ? "Enter the draw" : "Request this slot"}
          </Link>
        ) : (
          <>
            <Link href={missing.find((m) => m.href)?.href ?? "/profile"} className="btn-primary">
              Fix requirements
            </Link>
            <Link href={card.requestHref} className="btn-ghost">
              View slot
            </Link>
          </>
        )}
      </div>
    </article>
  );
}
