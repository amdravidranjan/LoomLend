import { getCurrentUser } from "@/lib/auth";
import { currentTime } from "@/lib/time";
import { impactScope, loadImpact, parseRange } from "@/lib/impact";
import { dayKey } from "@/lib/assistant-parse";

// GET /impact/export?days=30&dept=ECE — per-resource impact figures as CSV for the principal's office.

function cell(v: string | number | null) {
  if (v === null) return "";
  const s = String(v);
  // Quote everything textual; neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return typeof v === "number" ? s : `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Please sign in.", { status: 401 });
  const url = new URL(request.url);
  const scope = impactScope(user, url.searchParams.get("dept"));
  if (!scope) return new Response("The impact report is for department managers and administrators.", { status: 403 });
  const days = parseRange(url.searchParams.get("days"));
  const now = currentTime();
  const r = await loadImpact(scope, days, now);
  const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

  const head = [
    "resource_id",
    "resource",
    "department",
    "status",
    "open_hours",
    "booked_hours",
    "utilisation_pct",
    "idle_hours",
    "cross_department_hours",
    "loans",
    "people",
    "saved_inr",
    "market_rate_inr_per_hour",
    "purchase_value_inr",
    "cost_per_use_inr",
    "rent_per_use_inr",
    "unmet_hours",
    "unmet_requests",
    "unmet_waitlist_hours",
    "unmet_taken_hours",
    "unmet_cap_hours",
    "on_time_return_pct",
    "incidents",
    "recommendation",
  ];
  const lines = [head.join(",")];
  for (const x of r.resources) {
    lines.push(
      [
        cell(x.id),
        cell(x.name),
        cell(x.department),
        cell(x.status),
        round(x.openHours),
        round(x.bookedHours),
        round(x.utilisation * 100),
        round(x.idleHours),
        round(x.crossDeptHours),
        x.uses,
        x.people,
        x.saved,
        x.marketRatePerHour,
        x.purchaseValue,
        x.costPerUse,
        x.rentPerUse,
        round(x.unmetHours),
        x.unmetRequests,
        round(x.unmetByKind.waitlist),
        round(x.unmetByKind.taken),
        round(x.unmetByKind.cap),
        x.onTimeRate === null ? null : round(x.onTimeRate * 100),
        x.incidents,
        cell(x.recommendation?.text ?? ""),
      ]
        .map((v) => (v === null ? "" : typeof v === "number" ? String(v) : v))
        .join(","),
    );
  }
  const t = r.totals;
  lines.push(
    [
      cell("TOTAL"),
      cell(scope.label),
      cell(""),
      cell(""),
      round(t.openHours),
      round(t.bookedHours),
      round(t.utilisation * 100),
      round(Math.max(0, t.openHours - t.bookedHours)),
      round(t.crossDeptHours),
      t.uses,
      t.people,
      t.saved,
      "",
      "",
      "",
      "",
      round(t.unmetHours),
      "",
      "",
      "",
      "",
      t.onTimeRate === null ? "" : round(t.onTimeRate * 100),
      "",
      cell(""),
    ].join(","),
  );
  const slug = (scope.department ?? "campus").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="loomlend-impact-${slug}-${days}d-${dayKey(now)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
