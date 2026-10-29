"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { retryComparisonAction } from "@/app/actions-handover";
import { ActionForm, Submit } from "@/components/forms";
import type { ConditionDiff } from "@/lib/vision-types";

const GRID = 64; // both photos are sampled down to 64×64 grayscale
const CELL = 4; // 16×16 cells of 4×4 samples

async function grayscale(src: string) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = GRID;
  c.height = GRID;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.filter = "blur(1px)"; // soften sensor noise and JPEG artefacts
  ctx.drawImage(img, 0, 0, GRID, GRID);
  const px = ctx.getImageData(0, 0, GRID, GRID).data;
  const g = new Float32Array(GRID * GRID);
  let sum = 0;
  for (let i = 0; i < g.length; i++) {
    g[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    sum += g[i];
  }
  // Remove overall brightness so a darker room does not read as "everything changed".
  const mean = sum / g.length;
  for (let i = 0; i < g.length; i++) g[i] -= mean;
  return g;
}

/** Per-cell mean absolute difference, 0–255. */
async function pixelDiff(before: string, after: string) {
  const [a, b] = await Promise.all([grayscale(before), grayscale(after)]);
  const n = GRID / CELL;
  const cells: number[] = [];
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      let s = 0;
      for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
        const i = (cy * CELL + y) * GRID + cx * CELL + x;
        s += Math.abs(a[i] - b[i]);
      }
      cells.push(s / (CELL * CELL));
    }
  }
  const avg = cells.reduce((x, y) => x + y, 0) / cells.length;
  const changed = cells.filter((v) => v > 24).length;
  return { cells, n, score: Math.min(100, Math.round((avg / 64) * 100)), changedPct: Math.round((changed / cells.length) * 100) };
}

type Props = {
  before: string;
  after: string;
  diff: ConditionDiff | null;
  bookingId: string;
  canRetry: boolean;
  aiConfigured: boolean;
  staleMs: number;
  now: number;
};

/** Side-by-side condition photos with Claude's advisory change list and a pixel-difference heatmap fallback. */
export function ConditionCompare({ before, after, diff, bookingId, canRetry, aiConfigured, staleMs, now }: Props) {
  const overlay = useRef<HTMLCanvasElement>(null);
  const [heat, setHeat] = useState<null | { score: number; changedPct: number }>(null);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function toggle() {
    if (show) return setShow(false);
    setShow(true);
    if (heat) return;
    setBusy(true);
    setErr("");
    try {
      const d = await pixelDiff(before, after);
      const c = overlay.current;
      if (c) {
        c.width = d.n;
        c.height = d.n;
        const ctx = c.getContext("2d")!;
        ctx.clearRect(0, 0, d.n, d.n);
        d.cells.forEach((v, i) => {
          const alpha = Math.min(0.75, Math.max(0, (v - 8) / 48));
          ctx.fillStyle = `rgba(225, 29, 72, ${alpha.toFixed(3)})`;
          ctx.fillRect(i % d.n, Math.floor(i / d.n), 1, 1);
        });
      }
      setHeat({ score: d.score, changedPct: d.changedPct });
    } catch {
      setErr("The photos could not be compared in this browser.");
      setShow(false);
    } finally {
      setBusy(false);
    }
  }

  const pendingStale = diff?.status === "pending" && now - diff.requestedAt > staleMs;
  const showRetry = canRetry && aiConfigured && (!diff || diff.status === "error" || diff.status === "unavailable" || pendingStale);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <figure className="space-y-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={before} alt="Condition photo taken at pick-up" className="block h-auto w-full rounded-md border border-line" />
          <figcaption className="text-xs font-semibold text-muted uppercase">Before · pick-up</figcaption>
        </figure>
        <figure className="space-y-1">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={after} alt="Condition photo taken at return" className="block h-auto w-full rounded-md border border-line" />
            <canvas
              ref={overlay}
              aria-hidden
              className={`pointer-events-none absolute inset-0 h-full w-full rounded-md transition-opacity ${show && heat ? "opacity-100" : "opacity-0"}`}
              style={{ imageRendering: "auto", filter: "blur(6px)" }}
            />
          </div>
          <figcaption className="text-xs font-semibold text-muted uppercase">After · return</figcaption>
        </figure>
      </div>

      <AiResult diff={diff} aiConfigured={aiConfigured} pendingStale={pendingStale} />
      {showRetry && (
        <ActionForm action={retryComparisonAction} className="space-y-2">
          <input type="hidden" name="bookingId" value={bookingId} />
          <Submit className="btn-ghost min-h-11">{diff?.status === "error" || pendingStale ? "Try the AI comparison again" : "Run AI comparison"}</Submit>
        </ActionForm>
      )}

      <div className="rounded-lg border border-dashed border-line p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">Rough automatic check</p>
          <button type="button" onClick={toggle} aria-pressed={show} className="btn-ghost min-h-11" disabled={busy}>
            {busy ? "Comparing…" : show ? "Hide difference heatmap" : "Show difference heatmap"}
          </button>
        </div>
        {heat && (
          <p className="mt-1" role="status">
            Visual difference score <strong className="tabular-nums">{heat.score}/100</strong> · {heat.changedPct}% of the image changed noticeably
            {heat.score < 12 ? " (very similar)" : heat.score < 30 ? " (some changes)" : " (large changes)"}.
          </p>
        )}
        {err && <p className="mt-1 text-rose" role="alert">{err}</p>}
        <p className="mt-1 text-xs text-muted">
          Pixel comparison done in your browser, not AI. Red areas changed between the photos, but lighting, angle and framing changes show up too. Use it to know where to look, not as evidence.
        </p>
      </div>
    </div>
  );
}

function AiResult({ diff, aiConfigured, pendingStale }: { diff: ConditionDiff | null; aiConfigured: boolean; pendingStale: boolean }) {
  if (!diff || diff.status === "unavailable") {
    return (
      <p className="rounded-lg border border-indigo-200 bg-thread-soft/40 p-3 text-sm text-muted">
        {aiConfigured ? "AI photo comparison has not run yet for this booking." : "AI photo comparison is not configured on this server. Use the rough automatic check below."}
      </p>
    );
  }
  if (diff.status === "pending") {
    return (
      <p className="rounded-lg border border-indigo-200 bg-thread-soft/40 p-3 text-sm" role="status">
        {pendingStale ? "The AI comparison did not finish. You can run it again." : "Claude is comparing the two photos. Reload in a few seconds."}
      </p>
    );
  }
  if (diff.status === "error") {
    return <p className="rounded-lg border border-amber-200 bg-amber-soft p-3 text-sm text-amber-900" role="status">AI comparison unavailable: {diff.message}</p>;
  }
  const sev = { none: "bg-zinc-100 text-zinc-700", minor: "bg-amber-soft text-amber-900", major: "bg-rose-soft text-rose" } as const;
  return (
    <div className="rounded-lg border border-indigo-200 bg-thread-soft/40 p-3 text-sm">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="font-semibold text-thread">Photo comparison</span>
        <span className="rounded-md border border-line bg-white px-2 py-0.5 text-xs">Confidence: {diff.confidence}</span>
        <span className="text-xs text-muted">Claude vision · advisory only</span>
      </div>
      <p>{diff.summary}</p>
      {diff.changes.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {diff.changes.map((c, i) => (
            <li key={i} className="flex gap-2">
              <span className={`h-fit shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase ${sev[c.severity]}`}>{c.severity}</span>
              <span>
                <span className="font-medium">{c.area}:</span> {c.description}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-muted">No visible changes listed.</p>
      )}
      {diff.suggestsDamageReview && (
        <p className="mt-2 text-rose">
          Suggests a damage review.{" "}
          {diff.incidentId ? (
            <Link href={`/incidents/${diff.incidentId}`} className="underline">
              See the incident
            </Link>
          ) : null}
        </p>
      )}
      <p className="mt-1 text-xs text-muted">A person decides. This comparison cannot penalise anyone.</p>
    </div>
  );
}
