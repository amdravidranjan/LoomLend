import { inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AuditEntry } from "@/db/schema";
import { ACTION_LABEL } from "@/lib/audit";
import { fmtDateTime } from "@/lib/time";
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

  if (!entries.length) return <p className="text-sm text-muted">No activity yet.</p>;
  return (
    <ol className="relative space-y-4 border-l-2 border-dashed border-thread-soft pl-5">
      {entries.map((e) => {
        let details: Record<string, unknown> = {};
        try {
          details = JSON.parse(e.details);
        } catch {}
        const d = describe(details);
        return (
          <li key={e.seq} className="relative">
            <span className={`absolute top-1.5 -left-[27px] size-3 rounded-full border-2 border-card ${e.actorId ? "bg-thread" : "bg-saffron"}`} aria-hidden />
            <p className="text-sm">
              <span className="font-medium">{ACTION_LABEL[e.action] ?? e.action}</span>
              <span className="text-muted"> · {nameOf(e.actorId)}</span>
            </p>
            {d && <p className="text-sm break-words text-ink/75">{d}</p>}
            <p className="text-xs text-muted">
              {fmtDateTime(e.createdAt)}
              {showHash && <span className="ml-2 font-mono">#{e.seq} · {e.hash.slice(0, 10)}…</span>}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
