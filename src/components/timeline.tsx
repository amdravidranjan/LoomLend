import { inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AuditEntry } from "@/db/schema";
import { ACTION_LABEL } from "@/lib/audit";
import { currentTime, fmtDateTime, relative } from "@/lib/time";
import { conditionLabel } from "@/lib/catalog";

const SKIP = new Set(["resource", "name", "rule", "photo"]);

function describe(details: Record<string, unknown>) {
  return Object.entries(details)
    .filter(([k, v]) => !SKIP.has(k) && v !== null && v !== "" && v !== undefined && v !== false)
    .map(([k, v]) => {
      if (k.toLowerCase().includes("condition")) return `${k.replace(/([A-Z])/g, " $1").toLowerCase()}: ${conditionLabel(String(v))}`;
      if ((k === "from" || k === "to" || k === "dueAt" || k === "requestedEnd") && typeof v === "number") return `${k}: ${fmtDateTime(v)}`;
      return `${k.replace(/([A-Z])/g, " $1").toLowerCase()}: ${String(v)}`;
    })
    .join(" · ");
}

/** The activity history ("the Weave"): every important action, who did it and why. */
export async function Timeline({ entries, showHash = false }: { entries: AuditEntry[]; showHash?: boolean }) {
  const ids = [...new Set(entries.map((e) => e.actorId).filter(Boolean))] as string[];
  const actors = ids.length ? await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, ids)) : [];
  const nameOf = (id: string | null) => (id ? (actors.find((a) => a.id === id)?.name ?? "Unknown user") : "LoomLend rules");

  if (!entries.length) return <p className="text-sm text-muted">No activity yet. Every request, decision and hand-over will appear here.</p>;
  const now = currentTime();
  return (
    <ol className="stagger relative space-y-4 pl-6 before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-0.5 before:rounded-full before:bg-[linear-gradient(var(--thread-soft),var(--saffron-soft))]">
      {entries.map((e) => {
        let details: Record<string, unknown> = {};
        try {
          details = JSON.parse(e.details);
        } catch {}
        const d = describe(details);
        const system = !e.actorId;
        return (
          <li key={e.seq} className="relative">
            <span
              className={`absolute top-1 -left-6 size-3 rounded-full ring-4 ring-card ${system ? "bg-saffron" : "bg-thread"}`}
              aria-hidden
              title={system ? "Recorded by LoomLend's rules" : "Action by a person"}
            />
            <p className="text-sm">
              <span className="font-medium">{ACTION_LABEL[e.action] ?? e.action}</span>
              <span className="text-muted"> · {nameOf(e.actorId)}</span>
            </p>
            {d && <p className="text-sm break-words text-ink/75">{d}</p>}
            <p className="text-xs text-muted tabular">
              <time dateTime={new Date(e.createdAt).toISOString()} title={fmtDateTime(e.createdAt)}>
                {fmtDateTime(e.createdAt)} · {relative(e.createdAt, now)}
              </time>
              {showHash && (
                <span className="ml-2 font-mono" title={`Entry #${e.seq}, hash ${e.hash}`}>
                  #{e.seq} · {e.hash.slice(0, 10)}…
                </span>
              )}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
