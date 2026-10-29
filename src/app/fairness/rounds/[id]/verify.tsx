"use client";

import { useState } from "react";
import { verifyDraw, type DrawLog, type VerifyReport } from "@/lib/lottery";

type Props = { log: Pick<DrawLog, "commitment" | "entries" | "blocked" | "people">; seed: string };

/** Re-runs the published algorithm (the same TypeScript module the server used) with Web Crypto in this browser. */
export function VerifyInBrowser({ log, seed }: Props) {
  const [state, setState] = useState<{ status: "idle" | "running" | "done" | "error"; report?: VerifyReport; ms?: number; error?: string }>({ status: "idle" });

  async function go() {
    setState({ status: "running" });
    const t0 = performance.now();
    try {
      const report = await verifyDraw(log, seed);
      setState({ status: "done", report, ms: Math.round(performance.now() - t0) });
    } catch (e) {
      setState({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  const r = state.report;
  const ok = r && r.commitmentOk && r.resultsOk;
  return (
    <div className="space-y-3">
      <button type="button" onClick={go} className="btn-primary" disabled={state.status === "running"}>
        {state.status === "running" ? "Verifying…" : state.status === "done" ? "Verify again" : "Verify in your browser"}
      </button>
      <p className="text-xs text-muted">
        Nothing is sent to the server: your browser hashes the revealed seed, recomputes every entry&apos;s random number, key and outcome, and compares
        them with the published results.
      </p>
      {state.status === "error" && (
        <p role="alert" className="rounded-md border border-rose-200 bg-rose-soft px-3 py-2 text-sm text-rose">
          Could not run the check: {state.error}
        </p>
      )}
      {r && (
        <div role="status" aria-live="polite" className={`rounded-lg border p-4 text-sm ${ok ? "border-teal-200 bg-teal-soft text-teal" : "border-rose-200 bg-rose-soft text-rose"}`}>
          <p className="text-base font-semibold">
            {ok ? "✓ Verified: this draw is exactly what the published rules produce." : "✗ Mismatch: the published results do not match the rules."}
          </p>
          <ul className="mt-2 space-y-1">
            <li>
              {r.commitmentOk ? "✓" : "✗"} sha256(seed) = <code className="font-mono text-xs break-all">{r.computedCommitment}</code>{" "}
              {r.commitmentOk ? "matches the commitment published before entries closed." : "does NOT match the published commitment."}
            </li>
            <li>
              {r.resultsOk ? "✓" : "✗"} {r.recomputed.length} entr{r.recomputed.length === 1 ? "y" : "ies"} recomputed: weights, random numbers, keys, order and
              outcomes {r.resultsOk ? "all match" : "differ"}.
            </li>
            {state.ms !== undefined && <li className="text-xs opacity-80">Took {state.ms} ms in your browser.</li>}
          </ul>
          {r.mismatches.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {r.mismatches.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
