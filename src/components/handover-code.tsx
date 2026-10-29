"use client";

import { useActionState, useEffect, useState } from "react";
import { issueCodeAction } from "@/app/actions-handover";
import { Submit } from "@/components/forms";

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/**
 * Staff side of the one-time code: generate, show large with a live countdown.
 * The digits exist only in this response; the server stores a salted hash.
 */
export function HandoverCodePanel({ bookingId, purpose, liveUntil }: { bookingId: string; purpose: "check_out" | "return"; liveUntil?: number | null }) {
  const [state, action] = useActionState(issueCodeAction, undefined);
  const code = state?.code ? state : null;
  const now = useNow(Boolean(code) || Boolean(liveUntil));
  const left = code ? Math.max(0, Math.ceil((code.expiresAt - now) / 1000)) : 0;
  const expired = code ? left === 0 : false;
  const otherLive = !code && liveUntil && liveUntil > now;
  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;

  return (
    <div className="space-y-3 rounded-lg border border-line bg-white p-3">
      <div>
        <p className="font-medium">Give the borrower a one-time code</p>
        <p className="text-xs text-muted">
          They type it into their {purpose === "check_out" ? "check-in" : "return"} form while you are both at the item. Valid 5 minutes, single use, 5 attempts. Generating a new code cancels the old one.
        </p>
      </div>
      {code && !expired && (
        <div className="rounded-lg bg-ink p-4 text-center text-white" role="status" aria-live="polite">
          <p className="text-xs tracking-widest text-white/70 uppercase">Show this to the borrower</p>
          <p className="my-1 font-mono text-5xl font-bold tracking-[0.25em] tabular-nums" aria-label={`Code ${code.code.split("").join(" ")}`}>
            {code.code.slice(0, 3)} {code.code.slice(3)}
          </p>
          <p className={`text-sm tabular-nums ${left <= 60 ? "text-orange-300" : "text-white/80"}`}>
            Expires in <span aria-hidden>{mmss}</span>
            <span className="sr-only">{Math.ceil(left / 60)} minutes</span>
          </p>
          <div className="mx-auto mt-2 h-1.5 max-w-56 overflow-hidden rounded-full bg-white/20" aria-hidden>
            <div className="h-full bg-orange-400 transition-[width] duration-1000 ease-linear" style={{ width: `${(left / 300) * 100}%` }} />
          </div>
        </div>
      )}
      {code && expired && <p className="text-sm text-saffron" role="status">That code expired. Generate a new one if the borrower is still with you.</p>}
      {otherLive && <p className="text-xs text-muted">A code issued earlier is still live for {Math.ceil((liveUntil! - now) / 60000)} min. Its digits are not stored; generate a new one to see a code.</p>}
      <form action={action}>
        <input type="hidden" name="bookingId" value={bookingId} />
        <input type="hidden" name="purpose" value={purpose} />
        <Submit className="btn-ghost min-h-11 w-full">{code && !expired ? "Generate a new code" : "Generate code"}</Submit>
      </form>
      {state?.error && (
        <p role="alert" className="rounded-md border border-rose-200 bg-rose-soft px-3 py-2 text-sm text-rose">
          {state.error}
        </p>
      )}
    </div>
  );
}
